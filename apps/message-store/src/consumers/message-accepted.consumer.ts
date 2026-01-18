import type { MessageAcceptedEvent } from '@app/common';
import {
  CONVERSATION_PATTERNS,
  ConversationType,
  createLogger,
  KAFKA_TOPICS,
  MessageSavedEvent,
  REDIS_KEYS,
  SERVICES,
  MEDIA_PATTERNS,
} from '@app/common';
import {
  CONSUMER_GROUPS,
  KafkaHandler,
  KafkaProducerService,
} from '@app/kafka';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import type { MessageAttachment } from '../domain/interfaces';
import type { IMessageRepository } from '../domain/interfaces/message-repository.interface';
import { MESSAGE_REPOSITORY } from '../domain/interfaces/message-repository.interface';

/**
 * Message Accepted Consumer - Cursor-Based Architecture
 *
 * CRITICAL FLOW (Two-Phase Commit):
 * 1. Check if message already exists (idempotency)
 * 2. Create message with temporary offset=-1 (ensures message exists)
 * 3. Assign offset atomically (incrementMaxOffset)
 * 4. Update message with final offset
 * 5. Publish MESSAGE_SAVED notification
 *
 * This ensures:
 * - Message is persisted BEFORE offset increment
 * - No orphaned offsets if save fails
 * - Idempotent handling of Kafka retries
 * - ACID guarantees within each step
 *
 * Offset Assignment Logic:
 * - ALL conversation types: offset = incrementMaxOffset() → sequential
 *
 * MESSAGE_SAVED Event:
 * - Contains: messageId, conversationId, senderId, latestOffset, timestamp
 * - NO CONTENT - clients must HTTP GET to fetch messages
 * - This keeps WebSocket payload minimal
 *
 * Status Tracking:
 * - Uses cursor-based approach (no per-message receipts)
 * - Cursors managed in conversation_members table
 * - Status computed on-demand from message.offset vs user cursors
 */
@Injectable()
export class MessageAcceptedConsumer {
  private readonly logger = createLogger(MessageAcceptedConsumer.name);

  /**
   * Lua: atomically INCR the counter if the key already exists.
   * Returns the new value (>= 1) on success, or -1 when the key is absent
   * (cold start — caller must fall back to TCP to seed the counter).
   * Using a Lua script guarantees EXISTS + INCR are executed without
   * interleaving, which is important on Redis Cluster.
   */
  private static readonly INCR_IF_EXISTS_LUA = `
    if redis.call('EXISTS', KEYS[1]) == 0 then
      return -1
    end
    return redis.call('INCR', KEYS[1])
  `;

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepository: IMessageRepository,

    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,

    @Inject(SERVICES.MEDIA)
    private readonly mediaClient: ClientProxy,

    private readonly kafkaProducer: KafkaProducerService,

    @InjectRedis() private readonly redis: Redis,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.MESSAGE_ACCEPTED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMessageAccepted(payload: MessageAcceptedEvent): Promise<void> {
    try {
      this.logger.log(
        `[1/5] Consuming MESSAGE_ACCEPTED: ${payload.messageId} (${payload.conversationType})`,
      );

      // [STEP 0] Validate messageId is a valid UUID (skip old format messages)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(payload.messageId)) {
        this.logger.warn(
          `Skipping message with invalid UUID format: ${payload.messageId}. This is likely an old message from before UUID migration.`,
        );
        return; // Skip processing this message
      }

      const conversationType = payload.conversationType as ConversationType;
      const isMessageRequest =
        payload.metadata?.messageType === 'message_request';
      const mediaId = payload.metadata?.mediaId;

      // [STEP 1] Check if message already exists (idempotency check)
      try {
        const existingMessage = await this.messageRepository.findById(
          payload.messageId,
        );
        if (existingMessage) {
          this.logger.warn(
            `Message ${payload.messageId} already exists with offset ${existingMessage.offset}. Skipping duplicate (Kafka retry).`,
          );
          return; // Exit early - message already processed
        }
      } catch (error) {
        this.logger.error(
          `Failed to check message existence for ${payload.messageId}:`,
          error,
        );
        throw error;
      }

      // [STEP 2] Assign offset atomically via Redis INCR.
      //
      // Warm path (key exists in Redis): INCR returns the next offset in O(1)
      // with zero TCP/DB traffic — this is the common case after first message.
      //
      // Cold path (Redis evicted / fresh restart): Lua returns -1, we fall back
      // to the original TCP → conversation-service → DB path exactly once, then
      // seed the Redis counter so all subsequent messages use INCR.
      let offset: number;
      let fromRedis = false;
      const offsetKey = REDIS_KEYS.CHAT.CONVERSATION_MAX_OFFSET(
        payload.conversationId,
      );
      try {
        const luaResult = (await this.redis.eval(
          MessageAcceptedConsumer.INCR_IF_EXISTS_LUA,
          1,
          offsetKey,
        )) as number;

        if (luaResult !== -1) {
          // Warm path: Redis INCR succeeded
          offset = luaResult;
          fromRedis = true;
          this.logger.log(
            `[2/5] Offset ${offset} assigned via Redis INCR for ${conversationType} message ${payload.messageId}`,
          );
        } else {
          // Cold path: Redis key absent — fall back to TCP once to seed|
          this.logger.log(
            `[2/5] Redis offset counter cold for ${payload.conversationId}, seeding via TCP`,
          );
          const result = await firstValueFrom(
            this.conversationClient.send(
              CONVERSATION_PATTERNS.INCREMENT_MAX_OFFSET,
              { conversationId: payload.conversationId },
            ),
          );
          offset = result.maxOffset;
          if (offset === null || offset === undefined || isNaN(offset)) {
            throw new Error(
              `Invalid offset from INCREMENT_MAX_OFFSET for ${payload.conversationId}: ${offset}`,
            );
          }
          // Seed Redis (NX: only set if still absent — handles concurrent cold-starts
          // on the same conversation, which are sequential per Kafka partition key).
          await this.redis.set(offsetKey, String(offset), 'NX');
          this.logger.log(
            `[2/5] Offset ${offset} assigned via TCP (Redis seeded) for ${conversationType} message ${payload.messageId}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to assign offset for ${payload.messageId}:`,
          error,
        );
        throw error;
      }

      // [STEP 3] Store message with the real offset directly.
      // No longer need the two-phase (INSERT offset=-1, then UPDATE) pattern
      // because we obtain the offset BEFORE the INSERT.
      const p = payload as any;

      // Build attachments array with display metadata from DTO
      const attachments = this.buildAttachments(payload, p.attachments, mediaId);

      try {
        await this.messageRepository.create({
          id: payload.messageId,
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          // Fallback to empty string if content is null/undefined (for media-only messages)
          content: payload.content ?? '',
          type: payload.type || 'text',
          offset,
          replyToId: (payload as any).replyToId ?? payload.metadata?.replyToId,
          metadata: payload.metadata,
          isMessageRequest,
          attachments,
          // Forward metadata
          forwardedFromMessageId: p.forwardedFromMessageId ?? undefined,
          forwardedFromConversationId: p.forwardedFromConversationId ?? undefined,
          forwardedFromSenderId: p.forwardedFromSenderId ?? undefined,
          forwardedAt: p.forwardedAt ? new Date(p.forwardedAt) : undefined,
          forwardSnapshot: p.forwardSnapshot ?? undefined,
          createdAt: payload.timestamp,
        });
        this.logger.log(
          `[3/5] Message ${payload.messageId} stored with offset ${offset}${isMessageRequest ? ' (MESSAGE_REQUEST)' : ''}${mediaId ? ` with media ${mediaId}` : ''}`,
        );
      } catch (error) {
        if (error.code === '23505') {
          this.logger.warn(
            `Message ${payload.messageId} already exists. Skipping duplicate (race condition).`,
          );
          return;
        }
        this.logger.error(
          `Failed to store message ${payload.messageId}:`,
          error,
        );
        throw error;
      }

      // Mark conversation as dirty for OffsetSyncJob only when offset came from Redis
      // (TCP path already updated DB directly via INCREMENT_MAX_OFFSET).
      if (fromRedis) {
        this.redis
          .sadd(REDIS_KEYS.CHAT.CONVERSATION_OFFSET_DIRTY_SET, payload.conversationId)
          .catch(() => { /* non-critical — OffsetSyncJob will catch up */ });
      }

      // [STEP 3.5] Bind all media to message (for authorization)
      // Include video attachment IDs + optional thumbMediaId from metadata
      // (thumb is a separate image media entity uploaded by the FE client-side)
      const thumbMediaId: string | undefined = payload.metadata?.thumbMediaId as string | undefined;
      this.logger.log(
        `[3.5/5] metadata keys: ${JSON.stringify(Object.keys(payload.metadata ?? {}))}, thumbMediaId=${thumbMediaId}`,
      );
      const allMediaIds = [
        ...(attachments?.map((a: any) => a.mediaId).filter(Boolean) ?? []),
        ...(thumbMediaId ? [thumbMediaId] : []),
      ];
      for (const mid of allMediaIds) {
        try {
          await firstValueFrom(
            this.mediaClient.send(MEDIA_PATTERNS.BIND_TO_MESSAGE, {
              mediaId: mid,
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              boundByUserId: payload.senderId,
            }),
          );
          this.logger.log(
            `[3.5/5] Media ${mid} bound to message ${payload.messageId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to bind media ${mid} to message ${payload.messageId}: ${error.message}`,
            error.stack,
          );
        }
      }

      // [STEP 3.75] Resolve member IDs for notification fan-out.
      // ALWAYS fetch from conversation-service (TCP) to get the authoritative,
      // up-to-date member list. Using the Redis SET as primary source is unsafe
      // because it can be stale: if a MEMBER_REMOVED event hasn't been processed
      // by MembershipCacheConsumer yet, the SET still contains the removed user,
      // which would cause wrong push/WS notifications for that user.
      // The SET is only used as a last-resort fallback when TCP fails.
      let memberIds: string[] = [];
      const membersKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(payload.conversationId);
      try {
        const response: { members: Array<{ userId: string }> } = await firstValueFrom(
          this.conversationClient.send(
            CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES,
            { conversationId: payload.conversationId },
          ),
        );
        memberIds = (response?.members ?? []).map((m) => m.userId).filter(Boolean);
        if (memberIds.length > 0) {
          // Sync the SET so notification-service SMEMBERS fallback stays fresh.
          // Use a pipeline to atomically replace old members: DEL + SADD + EXPIRE.
          const pipeline = this.redis.pipeline();
          pipeline.del(membersKey);
          pipeline.sadd(membersKey, ...memberIds);
          pipeline.expire(membersKey, 60 * 60 * 24 * 7);
          pipeline.exec().catch(() => {/* non-critical */});
          this.logger.log(
            `[3.75/5] Resolved ${memberIds.length} members for ${payload.conversationId} via TCP`,
          );
        }
      } catch (err) {
        // TCP failure — fall back to Redis SET (may be stale but better than nothing)
        this.logger.warn(
          `[3.75/5] TCP member fetch failed for ${payload.conversationId}, falling back to Redis SET: ${err?.message}`,
        );
        try {
          memberIds = await this.redis.smembers(membersKey);
        } catch {
          // Redis also failed — continue with empty list; notifications will be skipped
        }
      }

      // [STEP 4] Publish MESSAGE_SAVED event
      // Includes full content so realtime-gateway can do Tier 2 active-chat push
      // without an extra HTTP round-trip for clients already in the conversation room.
      const savedEvent: MessageSavedEvent = {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        conversationType: payload.conversationType,
        senderId: payload.senderId,
        senderName: (payload as any).senderName,
        conversationName: (payload as any).conversationName,
        latestOffset: offset,
        createdAt: payload.timestamp,
        content: payload.content,
        type: payload.type,
        replyToId: (payload as any).replyToId ?? payload.metadata?.replyToId,
        metadata: payload.metadata,
        mentions: Array.isArray((payload as any).mentions)
          ? (payload as any).mentions
          : Array.isArray(payload.metadata?.mentions)
            ? payload.metadata.mentions
            : undefined,
        // Member IDs for notification fan-out (reliable fallback when notification-service
        // Redis cache is cold after a restart)
        memberIds: memberIds.length > 0 ? memberIds : undefined,
        // Structured attachment info for FE rendering
        attachments: attachments?.map((a: any) => ({
          mediaId: a.mediaId,
          kind: a.kind,
          status: a.status,
          mimeType: a.mimeType,
          fileName: a.fileName,
          sizeBytes: a.sizeBytes,
          meta: a.meta,
          // Pass FE poster through so message:new recipients see it immediately
          ...(a.thumb ? { thumb: a.thumb } : {}),
        })),
        // Forward info
        forwardedFrom: p.forwardedFromMessageId
          ? {
              messageId: p.forwardedFromMessageId,
              conversationId: p.forwardedFromConversationId,
              senderId: p.forwardedFromSenderId,
              forwardedAt: p.forwardedAt ? new Date(p.forwardedAt) : undefined,
              snapshot: p.forwardSnapshot,
            }
          : undefined,
      };

      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.MESSAGE_SAVED,
          key: payload.conversationId,
        },
        savedEvent,
      );

      this.logger.log(
        `[4/5] MESSAGE_SAVED notification published for ${conversationType} message ${payload.messageId}, offset: ${offset}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${payload.messageId}:`,
        error,
      );
      throw error; // Kafka will retry
    }
  }

  private buildAttachments(
    payload: MessageAcceptedEvent,
    rawAttachments: any[] | undefined,
    mediaId?: string,
  ): MessageAttachment[] | undefined {
    if (rawAttachments?.length) {
      return rawAttachments.map((a: any) => {
        const flatMeta =
          a.width || a.height || a.durationMs
            ? { width: a.width, height: a.height, durationMs: a.durationMs }
            : undefined;
        const thumb = a.thumb ?? (a.thumbUrl ? { url: a.thumbUrl, ready: false } : undefined);
        const kind = this.normalizeAttachmentKind(a.kind ?? a.type ?? payload.type);

        return {
          mediaId: a.mediaId,
          kind,
          status: a.status ?? 'PROCESSING',
          prefer: a.prefer ?? 'OPTIMIZED',
          mimeType: a.mimeType,
          fileName: a.fileName,
          sizeBytes: a.sizeBytes,
          meta: a.meta ?? flatMeta,
          ...(thumb ? { thumb } : {}),
          ...(a.variantsReady !== undefined ? { variantsReady: a.variantsReady } : {}),
          ...(a.variants ? { variants: a.variants } : {}),
          ...(a.error ? { error: a.error } : {}),
        };
      });
    }

    return mediaId
      ? [{
          mediaId,
          kind: this.normalizeAttachmentKind(payload.type),
          status: 'PROCESSING',
          prefer: 'OPTIMIZED',
        }]
      : undefined;
  }

  private normalizeAttachmentKind(value?: string): MessageAttachment['kind'] {
    const kind = (value ?? 'file').toLowerCase();
    return ['image', 'video', 'audio', 'file'].includes(kind)
      ? (kind as MessageAttachment['kind'])
      : 'file';
  }
}

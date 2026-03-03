import type {
  MemberAddedEvent,
  MemberRemovedEvent,
  MessageSavedEvent,
} from '@app/common';
import {
  CONVERSATION_PATTERNS,
  ConversationType,
  createLogger,
  KAFKA_TOPICS,
  MessageType,
  REDIS_KEYS,
  SERVICES,
  USERS_PATTERNS,
} from '@app/common';
import { CONSUMER_GROUPS, KafkaHandler } from '@app/kafka';
import { InjectRedis } from '@app/cache';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';
import { v5 as uuidv5 } from 'uuid';
import { DataSource } from 'typeorm';
import { OutboxRepository } from '@app/database-postgres';
import { createHash } from 'crypto';
import { Message } from '../domain/entities/message.entity';

interface IncrementOffsetResponse {
  maxOffset?: number | string | null;
}

interface UserDisplayNameRecord {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** Sentinel sender ID for all system-generated messages. */
const SYSTEM_SENDER_ID = 'SYSTEM';
const SYSTEM_MESSAGE_NAMESPACE = 'f352fca0-352b-47fe-8d38-c0122d6f39e8';

/**
 * System Message Consumer
 *
 * Listens to member-change and conversation-update Kafka events and
 * materialises a system message into the message history for each event.
 *
 * Flow:
 *   Kafka event (MEMBER_ADDED / MEMBER_REMOVED / GROUP.MEMBER_KICKED /
 *                GROUP.MEMBER_ROLE_CHANGED / CONVERSATION_UPDATED /
 *                GROUP.SETTINGS_UPDATED / GROUP.POLL_CLOSED / GROUP.POLL_VOTED /
 *                MESSAGE_UPDATED pin patches)
 *     → assign offset (same Redis INCR + TCP fallback as MessageAcceptedConsumer)
 *     → transactionally INSERT message + outbox row for MESSAGE_SAVED
 *     → MessageStoreOutboxProcessor publishes MESSAGE_SAVED after commit
 *     → realtime-gateway broadcasts message:new (type: 'system') to the conversation room
 *
 * This consumer runs under its own consumer group so it never interferes
 * with the MESSAGE_STORE group that handles MESSAGE_ACCEPTED.
 */
@Injectable()
export class SystemMessageConsumer {
  private readonly logger = createLogger(SystemMessageConsumer.name);

  /**
   * Lua: atomically INCR the counter if the key already exists.
   * Returns the new value on success, or -1 when the key is absent.
   */
  private static readonly INCR_IF_EXISTS_LUA = `
    if redis.call('EXISTS', KEYS[1]) == 0 then
      return -1
    end
    return redis.call('INCR', KEYS[1])
  `;

  constructor(
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,

    @Inject(SERVICES.USERS)
    private readonly usersClient: ClientProxy,

    private readonly outboxRepository: OutboxRepository,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ─── MEMBER_ADDED ─────────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_ADDED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleMemberAdded(payload: MemberAddedEvent): Promise<void> {
    // Only persist system messages for GROUP / ANNOUNCEMENT.
    // DIRECT conversations don't have meaningful "member added" history.
    if (payload.conversationType === ConversationType.DIRECT) return;

    // Skip generic MEMBER_ADDED when a dedicated JOIN_REQUEST_APPROVED
    // system message will be emitted by handleJoinApproved instead.
    if (payload.source === 'join_approved') return;

    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'MEMBER_ADDED',
        actorId: payload.addedBy,
        targetIds: payload.userIds,
      },
      payload.timestamp,
      (payload as { eventId?: string }).eventId,
    );
  }

  // ─── MEMBER_REMOVED ───────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_REMOVED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleMemberRemoved(payload: MemberRemovedEvent): Promise<void> {
    if (payload.conversationType === ConversationType.DIRECT) return;

    // Distinguish self-leave from admin removal.
    // If the actor is among the removed users, the user left voluntarily.
    const isSelfLeave = payload.userIds.includes(payload.removedBy);

    await this.createSystemMessage(
      payload.conversationId,
      {
        action: isSelfLeave ? 'MEMBER_LEFT' : 'MEMBER_REMOVED',
        actorId: payload.removedBy,
        targetIds: payload.userIds,
        visibility: payload.systemMessageVisibility ?? 'all',
        silent: payload.silent === true,
        ownershipTransferredTo: payload.ownershipTransferredTo,
      },
      payload.timestamp,
      (payload as { eventId?: string }).eventId,
    );
  }

  // ─── GROUP.MEMBER_KICKED ──────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.MEMBER_KICKED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleMemberKicked(payload: {
    conversationId: string;
    userId: string;
    kickedBy: string;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'MEMBER_KICKED',
        actorId: payload.kickedBy,
        targetIds: [payload.userId],
      },
      payload.timestamp,
      payload.eventId,
    );
  }

  // ─── GROUP.MEMBER_ROLE_CHANGED ────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleMemberRoleChanged(payload: {
    conversationId: string;
    userId: string;
    newRole: string;
    changedBy: string;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    // Ownership transfer gets a dedicated action so the FE can render
    // "X transferred ownership to Y" instead of the generic role-change text.
    const isOwnershipTransfer =
      payload.newRole?.toUpperCase() === 'OWNER';

    await this.createSystemMessage(
      payload.conversationId,
      isOwnershipTransfer
        ? {
            action: 'OWNERSHIP_TRANSFERRED',
            actorId: payload.changedBy,
            targetIds: [payload.userId],
          }
        : {
            action: 'ROLE_CHANGED',
            actorId: payload.changedBy,
            targetIds: [payload.userId],
            newRole: payload.newRole,
          },
      payload.timestamp,
      payload.eventId,
    );
  }

  // ─── CONVERSATION_UPDATED ─────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.CONVERSATION_UPDATED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleConversationUpdated(payload: {
    conversationId: string;
    updatedBy: string;
    changes: {
      name?: string;
      description?: string;
      avatarMediaId?: string;
    };
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    const { changes } = payload;

    // Only emit system messages for visible changes (name or avatar).
    // Description-only changes are silently skipped.
    const hasNameChange = changes.name !== undefined;
    const hasAvatarChange = changes.avatarMediaId !== undefined;

    if (!hasNameChange && !hasAvatarChange) return;

    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'GROUP_INFO_UPDATED',
        actorId: payload.updatedBy,
        changes: {
          ...(hasNameChange && { name: changes.name }),
          ...(hasAvatarChange && { avatarChanged: true }),
        },
      },
      payload.timestamp,
      payload.eventId,
    );
  }

  // ─── GROUP.SETTINGS_UPDATED ──────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.SETTINGS_UPDATED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleGroupSettingsUpdated(payload: {
    conversationId: string;
    updatedBy: string;
    changes: Record<string, unknown>;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'GROUP_SETTINGS_UPDATED',
        actorId: payload.updatedBy,
        changes: payload.changes,
      },
      payload.timestamp,
      payload.eventId,
    );
  }

  // ─── GROUP.POLL_CLOSED ────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.POLL_CLOSED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handlePollClosed(payload: {
    pollId: string;
    conversationId: string;
    closedBy: string;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'POLL_CLOSED',
        actorId: payload.closedBy,
        pollId: payload.pollId,
      },
      payload.timestamp,
      payload.eventId,
    );
  }

  // ─── GROUP.POLL_VOTED ─────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.POLL_VOTED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handlePollVoted(payload: {
    pollId: string;
    conversationId: string;
    userId: string;
    optionIds: string[];
    updatedOptions?: Array<{ id: string; text: string; voterIds: string[] }>;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    // Resolve human-readable option texts from the full options snapshot
    // so FE can render "Alice voted for 'This Friday'" without an extra fetch.
    const optionTexts: string[] = payload.updatedOptions
      ? payload.optionIds
          .map((id) => payload.updatedOptions!.find((o) => o.id === id)?.text)
          .filter((t): t is string => t !== undefined)
      : [];

    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'POLL_VOTED',
        actorId: payload.userId,
        pollId: payload.pollId,
        optionIds: payload.optionIds,
        optionTexts,
      },
      payload.timestamp,
      payload.eventId,
    );
  }

  // ─── GROUP.JOIN_REQUESTED (member_invite only) ──────────────────────────

  /**
   * When a member invites someone and joinApprovalRequired is true,
   * record a system message: "[Inviter] invited [User] (pending approval)".
   * Only emitted for source='member_invite'; regular requests/invite-link
   * requests do NOT generate a system message (they remain admin-only WS events).
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.JOIN_REQUESTED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleJoinRequested(payload: {
    conversationId: string;
    userId: string;
    requestId: string;
    source?: string;
    invitedBy?: string;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    // Only create system message for member_invite source
    if (payload.source !== 'member_invite' || !payload.invitedBy) return;

    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'MEMBER_INVITED',
        actorId: payload.invitedBy,
        targetIds: [payload.userId],
        visibility: 'all',
      },
      payload.timestamp,
      payload.eventId ?? `${payload.conversationId}:member_invited:${payload.requestId}`,
    );
  }

  // ─── GROUP.JOIN_APPROVED ─────────────────────────────────────────────────

  /**
   * Admin approved a join request → public system message visible to all
   * members: "[Admin] approved [User]'s request to join".
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.JOIN_APPROVED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleJoinApproved(payload: {
    conversationId: string;
    userId: string;
    reviewedBy: string;
    requestId: string;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'JOIN_REQUEST_APPROVED',
        actorId: payload.reviewedBy,
        targetIds: [payload.userId],
        visibility: 'all',
      },
      payload.timestamp,
      payload.eventId ?? `${payload.conversationId}:join_approved:${payload.requestId}`,
    );
  }

  // ─── GROUP.JOIN_REJECTED ─────────────────────────────────────────────────

  /**
   * Admin rejected a join request → admin-only system message so the
   * rejection is visible in the admin audit trail but hidden from members.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.JOIN_REJECTED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleJoinRejected(payload: {
    conversationId: string;
    userId: string;
    reviewedBy: string;
    requestId: string;
    timestamp: Date;
    eventId?: string;
  }): Promise<void> {
    await this.createSystemMessage(
      payload.conversationId,
      {
        action: 'JOIN_REQUEST_REJECTED',
        actorId: payload.reviewedBy,
        targetIds: [payload.userId],
        visibility: 'admins',
      },
      payload.timestamp,
      payload.eventId ?? `${payload.conversationId}:join_rejected:${payload.requestId}`,
    );
  }

  // ─── MESSAGE PIN / UNPIN ─────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE_SYSTEM_EVENTS,
    fromBeginning: false,
  })
  async handleMessagePinUpdated(payload: {
    messageId: string;
    conversationId: string;
    patch?: {
      isPinned?: boolean;
      pinnedBy?: string;
      pinnedAt?: Date | string;
      unpinnedBy?: string;
      unpinnedAt?: Date | string;
    };
    timestamp?: Date | string;
    eventId?: string;
  }): Promise<void> {
    const patch = payload.patch;
    if (!patch || patch.isPinned === undefined) return;

    const isPinned = patch.isPinned === true;
    const actorId = isPinned ? patch.pinnedBy : patch.unpinnedBy;
    if (!actorId) {
      this.logger.warn(
        `Skipping pin system message for ${payload.messageId}: missing actor`,
      );
      return;
    }

    const eventTimestamp =
      (isPinned ? patch.pinnedAt : patch.unpinnedAt) ?? payload.timestamp;

    await this.createSystemMessage(
      payload.conversationId,
      {
        action: isPinned ? 'MESSAGE_PINNED' : 'MESSAGE_UNPINNED',
        actorId,
        messageId: payload.messageId,
      },
      eventTimestamp,
      payload.eventId ??
        `${payload.conversationId}:${payload.messageId}:${isPinned ? 'pinned' : 'unpinned'}:${eventTimestamp ?? ''}:${actorId}`,
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Persist a system message and enqueue MESSAGE_SAVED in the transactional outbox.
   *
   * Durable strategy:
   *   1. Run offset assignment (Redis) and name resolution (Users TCP) in PARALLEL.
   *   2. Insert the system message and MESSAGE_SAVED outbox row in one DB transaction.
   *   3. Let MessageStoreOutboxProcessor publish MESSAGE_SAVED after commit.
   *
   * Errors are rethrown so Kafka can retry the source event if materialisation fails.
   */
  private async createSystemMessage(
    conversationId: string,
    metadata: Record<string, any>,
    eventTimestamp?: Date | string,
    sourceEventId?: string,
  ): Promise<void> {
    const createdAt = eventTimestamp ? new Date(eventTimestamp) : new Date();
    const sourceKey =
      sourceEventId ??
      `${conversationId}:${metadata.action}:${createdAt.toISOString()}:${JSON.stringify(metadata)}`;
    const sourceHash = createHash('sha256').update(sourceKey).digest('hex');
    const messageId = uuidv5(sourceKey, SYSTEM_MESSAGE_NAMESPACE);

    try {
      const exists = await this.dataSource.getRepository(Message).exists({
        where: { id: messageId },
      });
      if (exists) {
        await this.markOffsetDirtyIfCached(conversationId);
        this.logger.warn(
          `System message ${messageId} (${metadata.action}) already exists. Skipping duplicate event.`,
        );
        return;
      }

      const userIdsToResolve = this.extractUserIds(metadata);
      const [{ offset, fromRedis }, names] = await Promise.all([
        this.assignOffset(conversationId),
        this.resolveDisplayNames(userIdsToResolve),
      ]);

      const enrichedMetadata = this.enrichMetadata(metadata, names);

      const savedEvent: MessageSavedEvent = {
        messageId,
        conversationId,
        conversationType: 'group',
        senderId: SYSTEM_SENDER_ID,
        latestOffset: offset,
        createdAt,
        content: '',
        type: MessageType.SYSTEM,
        metadata: enrichedMetadata,
      };

      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(Message).insert({
          id: messageId,
          conversationId,
          senderId: SYSTEM_SENDER_ID,
          content: '',
          type: MessageType.SYSTEM,
          offset,
          metadata: enrichedMetadata,
          isMessageRequest: false,
          createdAt,
        });

        await this.outboxRepository.create(
          {
            aggregateType: 'message',
            aggregateId: messageId,
            eventType: 'message.saved',
            payload: savedEvent as unknown as Record<string, any>,
            kafkaTopic: KAFKA_TOPICS.MESSAGE_SAVED,
            kafkaKey: conversationId,
            idempotencyKey: `system-message-saved:${sourceHash}`,
          },
          manager,
        );
      });

      if (fromRedis) {
        void this.markOffsetDirty(conversationId);
      }

      this.logger.log(
        `System message ${messageId} (${enrichedMetadata.action}) persisted and MESSAGE_SAVED enqueued at offset ${offset}`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to create system message (${metadata.action}) for ${conversationId}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  private async markOffsetDirty(conversationId: string): Promise<void> {
    await this.redis
      .sadd(REDIS_KEYS.CHAT.CONVERSATION_OFFSET_DIRTY_SET, conversationId)
      .catch(() => {
        /* non-critical */
      });
  }

  private async markOffsetDirtyIfCached(conversationId: string): Promise<void> {
    const offsetKey = REDIS_KEYS.CHAT.CONVERSATION_MAX_OFFSET(conversationId);
    const hasCachedOffset = await this.redis.exists(offsetKey).catch(() => 0);
    if (hasCachedOffset) {
      await this.markOffsetDirty(conversationId);
    }
  }

  /**
   * Extract all user IDs from raw metadata for batch name resolution.
   * Handles actorId and targetIds[] present in all system message shapes.
   */
  private extractUserIds(metadata: Record<string, any>): string[] {
    const ids: string[] = [];
    if (metadata.actorId) ids.push(metadata.actorId as string);
    if (Array.isArray(metadata.targetIds))
      ids.push(...(metadata.targetIds as string[]));
    return ids.filter(Boolean);
  }

  /**
   * Annotate raw metadata with resolved display names.
   * Works generically: actorId → actorName, targetIds[] → targetNames[].
   */
  private enrichMetadata(
    raw: Record<string, any>,
    names: Map<string, string>,
  ): Record<string, any> {
    const enriched: Record<string, any> = { ...raw };
    if (raw.actorId) {
      enriched.actorName = names.get(raw.actorId as string);
    }
    if (Array.isArray(raw.targetIds)) {
      enriched.targetNames = (raw.targetIds as string[])
        .map((id) => names.get(id))
        .filter(Boolean);
    }
    return enriched;
  }

  /**
   * Assign the next sequential offset for the conversation.
   * Warm path: Redis INCR (O(1), no TCP).
   * Cold path: TCP to conversation-service, then seed Redis.
   */
  private async assignOffset(
    conversationId: string,
  ): Promise<{ offset: number; fromRedis: boolean }> {
    const offsetKey = REDIS_KEYS.CHAT.CONVERSATION_MAX_OFFSET(conversationId);

    const luaResult = (await this.redis.eval(
      SystemMessageConsumer.INCR_IF_EXISTS_LUA,
      1,
      offsetKey,
    )) as number;

    if (luaResult !== -1) {
      return { offset: luaResult, fromRedis: true };
    }

    // Cold path: Redis key absent — fall back to TCP once to seed
    const result = await firstValueFrom(
      this.conversationClient.send<
        IncrementOffsetResponse,
        { conversationId: string }
      >(CONVERSATION_PATTERNS.INCREMENT_MAX_OFFSET, { conversationId }),
    );

    const offset = Number(result.maxOffset);
    if (!Number.isFinite(offset)) {
      throw new Error(
        `Invalid offset from INCREMENT_MAX_OFFSET for ${conversationId}: ${result.maxOffset}`,
      );
    }

    // NX: only set if still absent (handles concurrent cold-starts)
    await this.redis.set(offsetKey, String(offset), 'NX');

    return { offset, fromRedis: false };
  }

  /**
   * Batch-fetch display names for a list of user IDs from the Users service.
   * Returns a Map<userId, displayName>. Soft-fails on any error (returns empty map).
   * Falls back to the raw userId string so callers always get something.
   */
  private async resolveDisplayNames(
    userIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return new Map();

    try {
      const users = await firstValueFrom(
        this.usersClient.send<UserDisplayNameRecord[], { ids: string[] }>(
          USERS_PATTERNS.GET_USERS_BY_IDS,
          { ids: unique },
        ),
        { defaultValue: [] },
      );

      const map = new Map<string, string>();
      for (const u of users ?? []) {
        if (!u?.id) continue;
        const name =
          u.username ||
          [u.firstName, u.lastName].filter(Boolean).join(' ') ||
          u.id;
        map.set(u.id, name);
      }
      return map;
    } catch {
      return new Map();
    }
  }
}

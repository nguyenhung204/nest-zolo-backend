import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { MessageSavedEvent } from '@app/common';
import {
  KAFKA_TOPICS,
  SERVICES,
  CONVERSATION_PATTERNS,
  createLogger,
  REDIS_KEYS,
} from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { InjectRedis } from '@app/cache';
import { ChatGateway } from '../chat/chat.gateway';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';

/**
 * Message Saved Consumer - Scalable Architecture with Personal Room Broadcast
 *
 * Consumes MESSAGE_SAVED notifications from MessageStore
 * For ALL conversation types (DIRECT/GROUP/ANNOUNCEMENT)
 *
 * CRITICAL PRINCIPLES:
 * 1. WebSocket is for NOTIFICATION, not data transport
 * 2. Emits lightweight 'message:notify' event
 * 3. Client receives notification → HTTP GET to fetch messages
 * 4. Keeps WS payload minimal (~50 bytes vs 10KB+)
 *
 * SCALABLE BROADCAST STRATEGY:
 *  OLD: Broadcast to `conversation:X` room (requires users to join conversation rooms)
 *  NEW: Broadcast to personal rooms `user:A`, `user:B`, `user:C` (members only)
 *
 * Benefits:
 * - Users only join 1 room: `user:${userId}` (no need to join 500+ conversation rooms)
 * - Receive notifications for ALL conversations
 * - Selective broadcast to members only (not global)
 * - Scale: O(members) broadcasts, not O(users)
 *
 * BATCH OPTIMIZATION:
 * - Buffer notifications for 80ms per conversation
 * - Multiple messages in rapid succession → single notify
 * - Reduces WS spam during fast chat
 * - Client fetches all new messages with one HTTP request
 *
 * PERFORMANCE OPTIMIZATION:
 * - Cache conversation members in Redis (TTL: 10 minutes)
 * - Cache key: `conversation:{id}:members`
 * - Invalidate on add/remove member events
 * - Reduces load on Conversation Service by 90%+
 */
@Injectable()
export class MessageSavedConsumer {
  private readonly logger = createLogger(MessageSavedConsumer.name);

  // Batch window duration (milliseconds)
  private readonly BATCH_WINDOW_MS = 80; // 80ms window

  // Cache TTL for conversation members (10 minutes)
  private readonly MEMBERS_CACHE_TTL = 600; // seconds

  // Redis key prefix for batch buffer
  private readonly BUFFER_KEY_PREFIX = 'notify:buffer:';

  constructor(
    private readonly chatGateway: ChatGateway,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.MESSAGE_SAVED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleMessageSaved(payload: MessageSavedEvent): Promise<void> {
    try {
      this.logger.log(
        `Processing MESSAGE_SAVED for message ${payload.messageId}, sender: ${payload.senderId}`,
      );

      // IMMEDIATE: Broadcast full message to conversation room (Tier 2)
      // Users actively viewing the conversation receive the full payload —
      // no extra HTTP GET needed. Content/type forwarded from MessageSavedEvent.
      //
      // Media strategy per type:
      //   image  → FE fetches original URL via GET /media/:mediaId/access-url?prefer=ORIGINAL
      //   video  → FE provides poster in attachment.thumb.url (client-captured frame); show it
      //            immediately; fetch play URL on demand via GET /media/:mediaId/play-info
      //   audio  → FE sends waveform+duration in metadata at creation; render player immediately
      //   file   → FE shows file card with metadata (name, size, mimeType)
      const messageNewPayload = {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        senderId: payload.senderId,
        offset: payload.latestOffset,
        content: payload.content,
        type: payload.type,
        replyToId: payload.replyToId,
        createdAt: payload.createdAt,
        metadata: payload.metadata,
        mentions: payload.mentions,
        // Structured attachment info — FE uses mediaId to fetch URLs on demand
        attachments: payload.attachments,
        // Forward info (only present on forwarded messages)
        forwardedFrom: payload.forwardedFrom,
      };

      const adminOnlySystemMessage =
        payload.type === 'system' && payload.metadata?.visibility === 'admins';
      const adminOnlyRecipientIds = adminOnlySystemMessage
        ? await this.getConversationAdminMembers(payload.conversationId)
        : undefined;

      if (adminOnlySystemMessage) {
        await this.chatGateway.notifyUsersSelf(adminOnlyRecipientIds ?? [], {
          event: 'message:new',
          data: messageNewPayload,
        });
      } else {
        this.chatGateway.server
          .to(`conversation:${payload.conversationId}`)
          .emit('message:new', messageNewPayload);
      }

      this.logger.debug(
        `Broadcast message:new to conversation:${payload.conversationId} room`,
      );

      // System messages are broadcast via message:new to the conversation room
      // (or admin personal rooms). message:saved / message:notify are irrelevant:
      // there is no human sender to confirm delivery to, and members don't need
      // a separate badge notification — the message:new event is sufficient.
      if (payload.type === 'system') return;

      // IMMEDIATE: Send delivery confirmation ONLY to sender's own sockets.
      // Must NOT use notifyUser() here — the `user:{id}` room is also joined by
      // friends for presence updates, so notifyUser() would leak message:saved to them.
      await this.chatGateway.notifySelf(payload.senderId, {
        event: 'message:saved',
        data: {
          messageId: payload.messageId,
          conversationId: payload.conversationId,
          offset: payload.latestOffset,
        },
      });

      // BATCHED: Buffer notification for members.
      // The sender is ALWAYS excluded (they already see it via message:new
      // in the conversation room + message:saved confirmation).
      // For forwarded messages, the sender still receives message:saved event
      // which contains the conversationId and can be used to update their
      // conversation list without needing a separate message:notify.
      //
      // Use payload.memberIds (authoritative TCP-based list from message-store)
      // as recipientIds so we skip the local JSON cache entirely and avoid
      // sending message:notify to users who were recently removed from the
      // conversation but whose removal hasn't propagated to the local cache yet.
      this.bufferNotification(
        payload.conversationId,
        payload.latestOffset,
        payload.senderId, // Always exclude sender
        {
          senderName: payload.senderName,
          content: payload.content,
          type: payload.type,
          conversationType: payload.conversationType,
          conversationName: payload.conversationName,
          mentions: payload.mentions,
          recipientIds: adminOnlySystemMessage
            ? adminOnlyRecipientIds
            : (payload.memberIds?.length ? payload.memberIds : undefined),
        },
      );
    } catch (error) {
      const e = error as Error;
      this.logger.error(
        `Failed to process MESSAGE_SAVED: ${e.message}`,
        e.stack,
      );
      // Don't throw - let Kafka acknowledge the message
    }
  }

  /**
   * Buffer notification using Redis for crash-safety.
   *
   * Strategy (no in-memory state required):
   * 1. SET key {latestOffset, excludeUserId} PX <window+margin>  — always overwrite with latest
   * 2. Schedule a setTimeout; each call schedules one, but only the callback that wins
   *    the atomic GETDEL will emit. The rest no-op.
   *
   * Crash safety: if the pod dies, the Redis key expires automatically after the TTL.
   * The notification for that window is silently dropped (client will see the message
   * on next poll/reconnect). This is acceptable vs. the alternative of a stale in-memory Map.
   */
  private bufferNotification(
    conversationId: string,
    latestOffset: number,
    excludeUserId: string | undefined,
    extra: {
      senderName?: string;
      content?: string;
      type?: string;
      conversationType: string;
      conversationName?: string;
      mentions?: string[];
      recipientIds?: string[];
    },
  ): void {
    const key = `${this.BUFFER_KEY_PREFIX}${conversationId}`;
    const value = JSON.stringify({ latestOffset, excludeUserId, ...extra });
    const ttlMs = this.BATCH_WINDOW_MS + 20; // slight margin so callback fires before key expires

    // Always write latest state; TTL ensures cleanup on crash
    this.redis.set(key, value, 'PX', ttlMs).catch((err) => {
      this.logger.error(
        `Failed to buffer notification for ${conversationId}: ${err.message}`,
      );
    });

    // Schedule callback; multiple may be scheduled — only the first GETDEL wins, rest no-op
    setTimeout(async () => {
      try {
        const raw = await this.redis.getdel(key);
        if (!raw) return; // Another callback already processed this window
        const {
          latestOffset: offset,
          excludeUserId: exUserId,
          ...notifyData
        } = JSON.parse(raw) as {
          latestOffset: number;
          excludeUserId?: string;
          senderName?: string;
          content?: string;
          type?: string;
          conversationType: string;
          conversationName?: string;
          mentions?: string[];
          recipientIds?: string[];
        };
        await this.emitNotification(
          conversationId,
          offset,
          exUserId,
          notifyData,
        );
      } catch (err) {
        this.logger.error(
          `Failed to emit buffered notification for ${conversationId}: ${(err as Error).message}`,
        );
      }
    }, this.BATCH_WINDOW_MS);
  }

  /**
   * Emit batched notification - Broadcast to personal rooms (scalable)
   *
   * Strategy:
   * 1. Try get members from Redis cache (fast path)
   * 2. If cache miss → Fetch from ConversationService + cache result
   * 3. Broadcast to each member's personal room: `user:${memberId}`
   * 4. Members receive notification regardless of which conversation they're viewing
   *
   * Complexity: O(M) where M = number of members (typically 2-100)
   * Not O(U) where U = total users in system
   *
   * Performance:
   * - Cache hit: ~1ms (Redis GET)
   * - Cache miss: ~10ms (TCP + Redis SET)
   * - Cache hit rate: 90%+ in high traffic
   */
  private async emitNotification(
    conversationId: string,
    latestOffset: number,
    excludeUserId: string | undefined,
    notifyData: {
      senderName?: string;
      content?: string;
      type?: string;
      conversationType: string;
      conversationName?: string;
      mentions?: string[];
      recipientIds?: string[];
    },
  ): Promise<void> {
    try {
      // Try get members from cache first (fast path)
      let memberIds =
        notifyData.recipientIds ??
        (await this.getConversationMembers(conversationId));

      this.logger.log(
        `[EMIT NOTIFY] Before filter: ${memberIds.length} members: ${memberIds.join(', ')}` +
          `${excludeUserId ? ` | Excluding sender: ${excludeUserId}` : ''}`,
      );

      // Filter out sender if provided (sender already received message:saved)
      if (excludeUserId) {
        memberIds = memberIds.filter((id) => id !== excludeUserId);
        this.logger.log(
          `[EMIT NOTIFY] After filter: ${memberIds.length} members: ${memberIds.join(', ')}`,
        );
      }

      if (memberIds.length === 0) {
        this.logger.warn(
          `No members found for conversation ${conversationId} after filtering, skipping notification`,
        );
        return;
      }

      // Filter out users who disabled desktop (WebSocket) notifications or muted via notifyFor
      memberIds = await this.filterDesktopEnabled(
        memberIds,
        notifyData.mentions ?? [],
      );

      if (memberIds.length === 0) {
        this.logger.log(
          `All members have desktop notifications disabled for conversation ${conversationId}, skipping`,
        );
        return;
      }

      const notificationPayload = {
        event: 'message:notify',
        data: {
          conversationId,
          latestOffset,
          senderName: notifyData.senderName,
          content: notifyData.content,
          type: notifyData.type,
          mentions: notifyData.mentions,
          ...(notifyData.conversationName
            ? { conversationName: notifyData.conversationName }
            : {}),
        },
      };

      this.logger.debug(
        `[SELF_NOTIFY] Sending message:notify to ${memberIds.length} members: ${memberIds.join(', ')} ` +
          `for conversation ${conversationId}, latestOffset: ${latestOffset}` +
          `${excludeUserId ? ` (excluded sender: ${excludeUserId})` : ''}`,
      );

      await this.chatGateway.notifyUsersSelf(memberIds, notificationPayload);

      this.logger.log(
        ` Batched notification sent to ${memberIds.length} member(s): [${memberIds.join(', ')}] ` +
          `for conversation ${conversationId}, latestOffset: ${latestOffset}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit notification for conversation ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get conversation members with Redis cache
   *
   * Cache strategy:
   * 1. Check Redis cache: `conversation:{id}:members`
   * 2. If hit → return cached array
   * 3. If miss → fetch from service + cache with TTL
   *
   * Cache invalidation:
   * - TTL: 10 minutes (auto-expire)
   * - Manual: on add/remove member events (TODO: implement listener)
   *
   * @param conversationId - Conversation ID
   * @returns Array of member user IDs
   */
  async getConversationMembers(conversationId: string): Promise<string[]> {
    const cacheKey = `conversation:${conversationId}:members`;

    try {
      // Try cache first
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        this.logger.debug(
          `Cache HIT for conversation ${conversationId} members`,
        );
        return JSON.parse(cached);
      }

      // Cache miss - fetch from service
      this.logger.debug(
        `Cache MISS for conversation ${conversationId} members, fetching from service...`,
      );

      const response = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_MEMBER_IDS, {
          conversationId,
        }),
      );

      const memberIds: string[] = response.memberIds || [];

      // Cache result with TTL
      await this.redis.setex(
        cacheKey,
        this.MEMBERS_CACHE_TTL,
        JSON.stringify(memberIds),
      );

      this.logger.debug(
        `Cached ${memberIds.length} members for conversation ${conversationId} (TTL: ${this.MEMBERS_CACHE_TTL}s)`,
      );

      return memberIds;
    } catch (error) {
      this.logger.error(
        `Failed to get members for conversation ${conversationId}: ${(error as Error).message}`,
      );

      // Fallback: try direct fetch without caching
      const response = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_MEMBER_IDS, {
          conversationId,
        }),
      );

      return response.memberIds || [];
    }
  }

  private async getConversationAdminMembers(
    conversationId: string,
  ): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.conversationClient.send(
          CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES,
          {
            conversationId,
          },
        ),
      );
      const members = response.members || [];
      return members
        .filter((member: { role?: string }) =>
          ['owner', 'admin'].includes(String(member.role ?? '').toLowerCase()),
        )
        .map((member: { userId: string }) => member.userId);
    } catch (error) {
      this.logger.error(
        `Failed to get admin members for ${conversationId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Invalidate conversation members cache
   *
   * Called when:
   * - Member added to conversation
   * - Member removed from conversation
   * - Conversation deleted
   *
   * Usage:
   * - Listen to Kafka events: MEMBER_ADDED, MEMBER_REMOVED
   * - Or call directly from API endpoints
   *
   * @param conversationId - Conversation ID to invalidate
   */
  async invalidateMembersCache(conversationId: string): Promise<void> {
    const cacheKey = `conversation:${conversationId}:members`;

    try {
      await this.redis.del(cacheKey);
      this.logger.log(
        `Invalidated members cache for conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to invalidate cache for conversation ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Filter out users who should not receive desktop (WebSocket) notifications.
   *
   * Gate logic (mirrors notification-service push gates but for WS):
   *   1. desktopEnabled=false → BLOCK
   *   2. notifyFor=NOTHING    → BLOCK
   *   3. notifyFor=MENTIONS_ONLY and user not in mentions → BLOCK
   *   4. Default → ALLOW
   *
   * Fail-open on Redis miss / parse error.
   *
   * @param userIds   Candidate recipient user IDs.
   * @param mentions  Array of user IDs explicitly mentioned in the message.
   */
  private async filterDesktopEnabled(
    userIds: string[],
    mentions: string[],
  ): Promise<string[]> {
    const checks = await Promise.all(
      userIds.map(async (id) => {
        try {
          const raw = await this.redis.get(
            REDIS_KEYS.NOTIFICATION.USER_GLOBAL(id),
          );
          if (!raw) return true;
          const s = JSON.parse(raw) as {
            desktopEnabled?: boolean;
            notifyFor?: string;
          };

          // Gate 1: desktopEnabled=false blocks all WS notifications
          if (s.desktopEnabled === false) return false;

          // Gate 2: notifyFor=NOTHING blocks all WS notifications
          if (s.notifyFor === 'NOTHING') return false;

          // Gate 3: notifyFor=MENTIONS_ONLY blocks plain messages (non-mentions)
          if (s.notifyFor === 'MENTIONS_ONLY' && !mentions.includes(id))
            return false;

          return true;
        } catch {
          return true; // fail-open: allow on Redis/parse error
        }
      }),
    );
    return userIds.filter((_, i) => checks[i]);
  }

  /**
   * Cleanup on shutdown — Redis-backed buffer requires no in-memory cleanup.
   * Pending keys expire automatically via Redis TTL.
   */
  onModuleDestroy() {
    this.logger.log(
      'MessageSavedConsumer shutting down; pending buffer keys will expire via Redis TTL',
    );
  }
}

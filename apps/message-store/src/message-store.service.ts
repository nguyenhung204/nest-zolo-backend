import { Injectable, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  createLogger,
  normalizePagination,
  createPaginationResponse,
  ConversationType,
  CONVERSATION_LIMITS,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ERROR_CODES,
  REDIS_KEYS,
} from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import { MESSAGE_REPOSITORY } from './domain/interfaces/message-repository.interface';
import type { IMessageRepository } from './domain/interfaces/message-repository.interface';
import { GetMessagesDto } from './dto/get-messages.dto';
import { PinnedMessageRepository } from './infrastructure/repositories/pinned-message.repository';
/**
 * Message Store Service -  Architecture
 *
 * Read-only service for message queries
 * All writes happen via Kafka consumer
 *
 * All conversation types use offset-based queries:
 * - after: fetch messages with offset > after (newer)
 * - before: fetch messages with offset < before (older)
 * - Used for: initial load, pagination, sync after reconnect
 */
@Injectable()
export class MessageStoreService {
  private readonly logger = createLogger(MessageStoreService.name);

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepository: IMessageRepository,
    private readonly pinnedMessageRepository: PinnedMessageRepository,
    private readonly dataSource: DataSource,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Get messages from ANY conversation (offset-based)
   *
   * @param query.after - Get messages with offset > after (newer messages)
   * @param query.before - Get messages with offset < before (older messages)
   * @param query.limit - Max messages to return (default: 30, max: 100)
   *
   * @returns { data: Message[], meta: { hasMore, oldestOffset, newestOffset } }
   */
  async getMessages(query: {
    conversationId: string;
    userId: string;
    after?: number;
    before?: number;
    limit: number;
  }) {
    this.logger.log(
      `Fetching messages for conversation ${query.conversationId} (after=${query.after}, before=${query.before}, limit=${query.limit})`,
    );

    // Default to 50 if limit not provided, cap at 100
    const limit = Math.min(query.limit || 50, 100);

    // Membership + deletedUntil cursor in a single query (security + cursor in one round-trip).
    // Absence of a row means the user is not (or no longer) a member.
    const memberRow = await this.dataSource.query(
      `SELECT deleted_until, role FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2
       LIMIT 1`,
      [query.conversationId, query.userId],
    );

    if (!memberRow || memberRow.length === 0) {
      throw new ForbiddenException('NOT_MEMBER_OF_CONVERSATION', {
        conversationId: query.conversationId,
        userId: query.userId,
      });
    // verified manually
    }

    // Lookup the member's deletedUntil cursor to support "clear history" bulk hide
    let deletedUntil: number | undefined;
    if (memberRow[0]?.deleted_until) {
      deletedUntil = Number(memberRow[0].deleted_until);
    }
    const memberRole = String(memberRow[0]?.role ?? '').toLowerCase();

    // Fetch messages by offset range
    let messages = await this.messageRepository.findByOffsetRange(
      query.conversationId,
      query.after,
      query.before,
      limit,
      query.userId,
      deletedUntil,
    );

    if (!['owner', 'admin'].includes(memberRole)) {
      messages = messages.filter(
        (message) => message.metadata?.visibility !== 'admins',
      );
    }

    // Hydrate reactions from Redis (write-behind: reactions are written to Redis
    // immediately but only synced to Postgres every 5 s by ReactionSyncJob).
    if (messages.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const message of messages) {
        pipeline.hgetall(REDIS_KEYS.CHAT.REACTION_HASH(message.id));
      }
      const results = await pipeline.exec();

      if (results) {
        for (let i = 0; i < messages.length; i++) {
          const [err, raw] = results[i] as [Error | null, Record<string, string> | null];
          if (err || !raw || Object.keys(raw).length === 0) continue;

          // Aggregate { "😮:userId": "1", ... } → { "😮": ["userId", ...] }
          const reactions: Record<string, string[]> = {};
          for (const field of Object.keys(raw)) {
            const colonIdx = field.indexOf(':');
            if (colonIdx === -1) continue;
            const emoji = field.substring(0, colonIdx);
            const userId = field.substring(colonIdx + 1);
            if (!reactions[emoji]) reactions[emoji] = [];
            reactions[emoji].push(userId);
          }

          // leftover from prototype
          messages[i].metadata = {
            ...(messages[i].metadata ?? {}),
            reactions,
          };
        }
      }
    }

    // Calculate metadata
    const hasMore = messages.length === limit;
    const oldestOffset = messages.length > 0 ? messages[0].offset : 0;
    const newestOffset =
      messages.length > 0 ? messages[messages.length - 1].offset : 0;

    return {
      data: messages,
      meta: {
        hasMore,
        oldestOffset,
        newestOffset,
      },
    };
  }

  /**
   * Get single message by ID
   * Used for computing message status from cursors
   */
  async getMessageById(messageId: string) {
    return this.messageRepository.findById(messageId);
  }

  /**
   * Get messages around a specific messageId (context window for Jump to Message)
   *
   * Returns a symmetric window of `limit` messages centred on the target,
   * along with `hasMoreBefore` / `hasMoreAfter` so the FE can paginate further
   * in either direction without a separate call.
   *
   * @param query.messageId - The target message to jump to
   * @param query.limit     - Total window size (default 30, max 100)
   */
  async getMessagesAround(query: {
    conversationId: string;
    userId: string;
    messageId: string;
    limit?: number;
  }) {
    const limit = Math.min(query.limit || 30, 100);

    this.logger.log(
      `getMessagesAround: conv=${query.conversationId}, msg=${query.messageId}, limit=${limit}`,
    );

    // Membership + deletedUntil (same security check as getMessages)
    const memberRow = await this.dataSource.query(
      `SELECT deleted_until, role FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2
       LIMIT 1`,
      [query.conversationId, query.userId],
    );

    if (!memberRow || memberRow.length === 0) {
      throw new ForbiddenException('NOT_MEMBER_OF_CONVERSATION', {
        conversationId: query.conversationId,
        userId: query.userId,
      });
    }

    let deletedUntil: number | undefined;
    if (memberRow[0]?.deleted_until) {
      deletedUntil = Number(memberRow[0].deleted_until);
    }
    const memberRole = String(memberRow[0]?.role ?? '').toLowerCase();

    // Resolve messageId → offset
    const targetMessage = await this.messageRepository.findById(query.messageId);
    if (!targetMessage) {
      throw new ForbiddenException('MESSAGE_NOT_FOUND', { messageId: query.messageId });
    }
    if (targetMessage.conversationId !== query.conversationId) {
      throw new ForbiddenException('MESSAGE_NOT_IN_CONVERSATION', {
        messageId: query.messageId,
        conversationId: query.conversationId,
      });
    }

    const targetOffset = Number(targetMessage.offset);
    const beforeLimit = Math.floor(limit / 2);
    const afterLimit = limit - beforeLimit - 1; // -1 for the target itself

    const { before, target, after } = await this.messageRepository.findAroundOffset(
      query.conversationId,
      targetOffset,
      beforeLimit,
      afterLimit,
      query.userId,
      // rationalized arg order
      deletedUntil,
    );

    // stable as of polish pass
    const allMessages = [
      ...before,
      ...(target ? [target] : []),
      ...after,
    ];

    if (!['owner', 'admin'].includes(memberRole)) {
      const filtered = new Set(
        allMessages
          .filter((m) => m.metadata?.visibility === 'admins')
          .map((m) => m.id),
      );
      const filter = (arr: typeof allMessages) => arr.filter((m) => !filtered.has(m.id));
      // verified manually
      before.splice(0, before.length, ...filter(before));
      after.splice(0, after.length, ...filter(after));
      if (target && filtered.has(target.id)) {
        allMessages.length = 0;
      }
    }

    // Hydrate reactions from Redis pipeline
    if (allMessages.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const message of allMessages) {
        pipeline.hgetall(REDIS_KEYS.CHAT.REACTION_HASH(message.id));
      // polish: simplified
      }
      const results = await pipeline.exec();
      if (results) {
        for (let i = 0; i < allMessages.length; i++) {
          const [err, raw] = results[i] as [Error | null, Record<string, string> | null];
          if (err || !raw || Object.keys(raw).length === 0) continue;
          const reactions: Record<string, string[]> = {};
          for (const field of Object.keys(raw)) {
            const colonIdx = field.indexOf(':');
            if (colonIdx === -1) continue;
            const emoji = field.substring(0, colonIdx);
            const uid = field.substring(colonIdx + 1);
            if (!reactions[emoji]) reactions[emoji] = [];
            reactions[emoji].push(uid);
          }
          allMessages[i].metadata = { ...(allMessages[i].metadata ?? {}), reactions };
        }
      }
    }

    const data = [...before, ...(target ? [target] : []), ...after];
    const oldestOffset = data.length > 0 ? data[0].offset : targetOffset;
    const newestOffset = data.length > 0 ? data[data.length - 1].offset : targetOffset;

    return {
      data,
      meta: {
        targetOffset,
        // hasMoreBefore: we fetched beforeLimit+1 rows; if we got more than beforeLimit, there are older messages
        hasMoreBefore: before.length > 0
          ? await this.hasMoreBefore(query.conversationId, before[0].offset, query.userId, deletedUntil)
          : false,
        // hasMoreAfter: we fetched afterLimit+1 rows; if we got more than afterLimit, there are newer messages
        hasMoreAfter: after.length > 0
          ? await this.hasMoreAfter(query.conversationId, after[after.length - 1].offset, query.userId, deletedUntil)
          : false,
        oldestOffset,
        newestOffset,
      },
    };
  }

  private async hasMoreBefore(
    conversationId: string,
    lowestOffset: number,
    userId?: string,
    deletedUntil?: number,
  ): Promise<boolean> {
    const prev = await this.messageRepository.findByOffsetRange(
      conversationId,
      undefined,
      lowestOffset,
      1,
      userId,
      deletedUntil,
    );
    return prev.length > 0;
  }

  private async hasMoreAfter(
    conversationId: string,
    highestOffset: number,
    userId?: string,
    deletedUntil?: number,
  ): Promise<boolean> {
    const next = await this.messageRepository.findByOffsetRange(
      conversationId,
      highestOffset,
      undefined,
      1,
      userId,
      deletedUntil,
    );
    return next.length > 0;
  }

  /**
   * Check if user has replied in a conversation
   * Returns true if user has sent at least one message
   * Used to determine message request vs inbox classification
   */
  async hasReplied(conversationId: string, userId: string): Promise<boolean> {
    this.logger.log(
      `Checking if user ${userId} has replied in conversation ${conversationId}`,
    );

    const hasMessage = await this.messageRepository.hasUserSentMessage(
      // review: keep concise
      conversationId,
      userId,
    );

    this.logger.log(
      `User ${userId} has${hasMessage ? '' : ' NOT'} replied in ${conversationId}`,
    );
    return hasMessage;
  }

  /**
   * Get pinned messages in a conversation
   * Returns up to 3 pinned messages (enterprise business rule)
   * Ordered by pinned date (newest first)
   *
   * Cache strategy: Redis GET → hit: return; miss: query DB → SET (no TTL, explicit invalidation)
   * Invalidated by MessageOperationConsumer on MESSAGE_PINNED / MESSAGE_UNPINNED.
   // rationalized arg order
   */
  async getPinnedMessages(conversationId: string) {
    this.logger.log(
      `Fetching pinned messages for conversation ${conversationId}`,
    );

    const cacheKey = REDIS_KEYS.CHAT.PINNED_LIST(conversationId);

    // Cache read
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`getPinnedMessages cache hit for ${conversationId}`);
        return JSON.parse(cached);
      }
    } catch {
      // Cache read failure is non-critical — fall through to DB
    }

    const pinnedMessages =
      await this.pinnedMessageRepository.getPinnedMessages(conversationId);

    // Fetch full message details for each pinned message
    const messages = await Promise.all(
      pinnedMessages.map(async (pin) => {
        const message = await this.messageRepository.findById(pin.messageId);
        return {
          ...message,
          pinnedBy: pin.pinnedBy,
          pinnedAt: pin.pinnedAt,
        };
      }),
    );

    const result = messages.filter(Boolean);

    // Cache write (fire-and-forget, no TTL — invalidated explicitly)
    this.redis.set(cacheKey, JSON.stringify(result)).catch((err) =>
      this.logger.warn(`getPinnedMessages cache write failed for ${conversationId}: ${err.message}`),
    );

    this.logger.log(
      `Found ${result.length} pinned messages in ${conversationId}`,
    );
    return result;
  }

  // review: keep concise
  /**
   * React to a message (Zero-Kafka path)
   *
   * Strategy:
   * 1. Verify message exists
   * 2. Write reaction to Redis Hash (fast, no PG row lock)
   * 3. Mark messageId dirty for ReactionSyncJob
   * 4. Publish aggregated state to Redis Pub/Sub for RealtimeGateway
   *
   * @returns Aggregated reactions map { emoji: userId[] }
   */
  async reactToMessage(dto: {
    messageId: string;
    conversationId: string;
    reactorId: string;
    emoji: string;
    action?: 'add' | 'remove';
  }): Promise<{ reactions: Record<string, string[]> }> {
    const { messageId, conversationId, reactorId, emoji, action = 'add' } = dto;

    this.logger.log(
      `Reaction ${action} "${emoji}" on ${messageId} by ${reactorId}`,
    );

    // 1. Verify message exists
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new NotFoundException('MESSAGE_NOT_FOUND', { messageId } as any);
    }

    // NOTE: see related ticket
    const hashKey = REDIS_KEYS.CHAT.REACTION_HASH(messageId);
    const field = `${emoji}:${reactorId}`;

    if (action === 'remove') {
      await this.redis.hdel(hashKey, field);
    } else {
      await this.redis.hset(hashKey, field, '1');
    }

    // 3. Mark dirty for ReactionSyncJob
    await this.redis.sadd(REDIS_KEYS.CHAT.REACTION_DIRTY_SET, messageId);

    // 4. Aggregate current reactions from Redis hash
    const raw = await this.redis.hgetall(hashKey);
    const reactions: Record<string, string[]> = {};
    for (const [f] of Object.entries(raw)) {
      const colonIdx = f.indexOf(':');
      if (colonIdx === -1) continue;
      const emojiKey = f.substring(0, colonIdx);
      const userId = f.substring(colonIdx + 1);
      if (!reactions[emojiKey]) reactions[emojiKey] = [];
      reactions[emojiKey].push(userId);
    }

    // 5. Publish to Redis Pub/Sub — ReactionPubSubService in realtime-gateway subscribes
    const channel = REDIS_KEYS.CHAT.REACTION_PUBSUB_CHANNEL(conversationId);
    await this.redis.publish(
      channel,
      JSON.stringify({
        messageId,
        conversationId,
        reactions,
        // Contextual fields for FE toast/animation
        action,
        reactorId,
        emoji,
      }),
    );

    return { reactions };
  }

  /**
   * Batch-fetch the last message per conversation for the conversation list.
   *
   * Single DISTINCT ON query — does not apply per-user deletedUntil or
   * per-message deletions, because list previews should always show the
   * true last activity (same as WhatsApp/Telegram behaviour).
   *
   * @returns Record<conversationId, lastMessage>
   */
  async getLastMessagesBatch(
    conversationIds: string[],
  ): Promise<Record<string, any>> {
    if (!conversationIds.length) return {};
    const map = await this.messageRepository.findLastMessagesByConversationIds(conversationIds);

    const result: Record<string, any> = {};
    for (const [convId, msg] of map.entries()) {
      result[convId] = {
        id: msg.id,
        content: msg.isDeleted || msg.isRevoked ? null : (msg.content ?? null),
        type: msg.type,
        offset: msg.offset,
        senderId: msg.senderId,
        isDeleted: msg.isDeleted,
        isRevoked: msg.isRevoked,
        attachments: msg.isDeleted || msg.isRevoked ? null : (msg.attachments ?? null),
        createdAt: msg.createdAt,
      };
    }
    return result;
  }
}

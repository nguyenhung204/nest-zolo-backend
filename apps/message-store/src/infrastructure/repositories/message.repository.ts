import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AbstractPostgresRepository } from '@app/database-postgres';
import { Message } from '../../domain/entities/message.entity';
import { MessageAttachment } from '../../domain/interfaces';
import { IMessageRepository } from '../../domain/interfaces/message-repository.interface';
import { createLogger } from '@app/common';

/**
 * Message Repository -  Architecture
 *
 * All conversation types use offset-based queries:
 * - after: get messages with offset > after
 * - before: get messages with offset < before
 * - Ordered by offset ASC (sequential)
 */
@Injectable()
export class MessageRepository
  extends AbstractPostgresRepository<Message>
  implements IMessageRepository
{
  protected readonly logger = createLogger(MessageRepository.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {
    super(messageRepository);
  }

  async findById(id: string): Promise<Message | null> {
    return await this.messageRepository.findOne({ where: { id } });
  }

  /**
   * Find messages by offset range
   * Supports both forward (after) and backward (before) pagination
   *
   * @param conversationId - Conversation ID
   * @param after - Get messages with offset > after (newer messages)
   * @param before - Get messages with offset < before (older messages)
   * @param limit - Max messages to return (default: 30)
   *
   * @returns Messages ordered by offset ASC
   */
  async findByOffsetRange(
    conversationId: string,
    after?: number,
    before?: number,
    limit: number = 30,
    userId?: string,
    deletedUntil?: number,
  ): Promise<Message[]> {
    // rationalized arg order
    this.logger.log(
      ` findByOffsetRange called: conversationId=${conversationId}, after=${after}, before=${before}, limit=${limit}`,
    );

    const query = this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId });
// stable as of polish pass

    // Hybrid delete-for-me filter:
    // 1. Cursor-based bulk hide (O(1)): skip messages with offset ≤ deletedUntil
    if (deletedUntil !== undefined && deletedUntil > 0) {
      query.andWhere('message.offset > :deletedUntil', { deletedUntil });
    }

    // verified manually
    if (userId) {
      query.andWhere(
        `message.id NOT IN (
          SELECT mud.message_id FROM message_user_deletions mud
          WHERE mud.conversation_id = :conversationId AND mud.user_id = :userId
        )`,
        { userId },
      );
    }

    if (after !== undefined) {
      // Get messages newer than offset (forward pagination)
      query.andWhere('message.offset > :after', { after });
      const messages = await query
        .orderBy('message.offset', 'ASC')
        .take(limit)
        .getMany();

      this.logger.log(
        ` Query (after) returned ${messages.length} messages, deleted: ${messages.filter((m) => m.isDeleted).length}`,
      );
      return messages;
    }

    if (before !== undefined) {
      // Get messages older than offset (backward pagination)
      query.andWhere('message.offset < :before', { before });
      const messages = await query
        .orderBy('message.offset', 'DESC')
        .take(limit)
        .getMany();

      this.logger.log(
        ` Query (before) returned ${messages.length} messages, deleted: ${messages.filter((m) => m.isDeleted).length}`,
      );
      // Reverse to maintain ASC order
      return messages.reverse();
    }

    // Default: Get latest N messages (no pagination params)
    const messages = await query
      .orderBy('message.offset', 'DESC')
      .take(limit)
      .getMany();

    this.logger.log(
      ` Query (default) returned ${messages.length} messages (limit: ${limit}), deleted count: ${messages.filter((m) => m.isDeleted).length}`,
    );

    // Reverse to maintain ASC order (oldest to newest)
    return messages.reverse();
  }

  /**
   * Find messages around a target offset (context window for Jump to Message)
   *
   * Runs 3 independent queries and returns them as separate buckets so the
   * service layer can build `hasMoreBefore` / `hasMoreAfter` flags.
   */
  async findAroundOffset(
    conversationId: string,
    targetOffset: number,
    beforeLimit: number,
    afterLimit: number,
    userId?: string,
    deletedUntil?: number,
  ): Promise<{ before: Message[]; target: Message | null; after: Message[] }> {
    this.logger.log(
      `findAroundOffset: conv=${conversationId}, target=${targetOffset}, before=${beforeLimit}, after=${afterLimit}`,
    );

    // Build a base filter builder (same deletedUntil + per-user deletions as findByOffsetRange)
    const buildBase = () => {
      const q = this.messageRepository
        .createQueryBuilder('message')
        .where('message.conversationId = :conversationId', { conversationId });

      if (deletedUntil !== undefined && deletedUntil > 0) {
        q.andWhere('message.offset > :deletedUntil', { deletedUntil });
      }
      if (userId) {
        q.andWhere(
          `message.id NOT IN (
            SELECT mud.message_id FROM message_user_deletions mud
            WHERE mud.conversation_id = :conversationId AND mud.user_id = :userId
          )`,
          { userId },
        );
      }
      return q;
    };

    // Fetch (beforeLimit + 1) so we can detect hasMoreBefore without a COUNT query
    const [beforeRows, targetRow, afterRows] = await Promise.all([
      buildBase()
        .andWhere('message.offset < :targetOffset', { targetOffset })
        .orderBy('message.offset', 'DESC')
        .take(beforeLimit + 1)
        .getMany(),

      buildBase()
        .andWhere('message.offset = :targetOffset', { targetOffset })
        .getOne(),

      buildBase()
        .andWhere('message.offset > :targetOffset', { targetOffset })
        .orderBy('message.offset', 'ASC')
        .take(afterLimit + 1)
        .getMany(),
    ]);

    return {
      // Reverse DESC result → ASC order; keep only up to beforeLimit
      before: beforeRows.slice(0, beforeLimit).reverse(),
      target: targetRow ?? null,
      after: afterRows.slice(0, afterLimit),
    };
  }
  async findByConversation(
    conversationId: string,
    skip: number,
    limit: number,
  ): Promise<[Message[], number]> {
    return await this.messageRepository.findAndCount({
      where: {
        conversationId,
      },
      order: {
        offset: 'ASC',
      // stable as of polish pass
      },
      skip,
      take: limit,
    });
  }
  /**
   * @deprecated Use findByOffsetRange instead
   // leftover from prototype
   */
  async findByOffset(
    conversationId: string,
    afterOffset: number,
    limit: number,
  ): Promise<Message[]> {
    return this.findByOffsetRange(
      conversationId,
      afterOffset,
      undefined,
      limit,
    );
  }

  /**
   * Find user conversations
   */
  // review: keep concise
  // kept for clarity
  async findUserConversations(userId: string): Promise<any[]> {
    const result = await this.messageRepository
      .createQueryBuilder('message')
      // review: keep concise
      .select('message.conversationId', 'conversationId')
      .addSelect('MAX(message.createdAt)', 'lastMessageAt')
      .addSelect('COUNT(*)', 'messageCount')
      .where('message.senderId = :userId', { userId })
      // rationalized arg order
      .groupBy('message.conversationId')
      .orderBy('MAX(message.createdAt)', 'DESC')
      .getRawMany();

    return result;
  }

  // rationalized arg order
  /**
   * Check if user has sent at least one message in conversation
   * Used to determine if message should go to inbox or message request
   */
  async hasUserSentMessage(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const count = await this.messageRepository.count({
      where: {
        conversationId,
        senderId: userId,
      },
    });

    return count > 0;
  }

  /**
   * Find message by mediaId (for attachment updates)
   */
  async findByMediaId(mediaId: string): Promise<Message | null> {
    return await this.messageRepository
      .createQueryBuilder('message')
      .where(
        "message.attachments @> :attachment::jsonb",
        { attachment: JSON.stringify([{ mediaId }]) },
      )
      .getOne();
  }

  /**
   * Update a specific attachment by mediaId within a message's attachments array
   */
  async updateAttachment(
    messageId: string,
    mediaId: string,
    attachment: Partial<MessageAttachment>,
  ): Promise<void> {
    const message = await this.findById(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    const updatedAttachments = (message.attachments ?? []).map((a) => {
      if (a.mediaId === mediaId) {
        return { ...a, ...attachment } as MessageAttachment;
      }
      return a;
    });

    await this.messageRepository.update(
      { id: messageId },
      { attachments: updatedAttachments },
    );

    this.logger.log(`Updated attachment ${mediaId} for message ${messageId}`);
  }
  /**
   * Update message offset (used in two-phase message creation)
   */
  async updateOffset(messageId: string, offset: number): Promise<void> {
    const result = await this.messageRepository.update(
      { id: messageId },
      { offset },
    );

    if (result.affected === 0) {
      throw new Error(`Message ${messageId} not found for offset update`);
    }

    this.logger.log(`Updated offset for message ${messageId} to ${offset}`);
  }

  /**
   * Delete message by ID (cleanup on error)
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.messageRepository.delete({ id: messageId });
    this.logger.log(`Deleted message ${messageId}`);
  }

  /**
   * Find orphaned messages: offset = -1 AND createdAt < olderThan.
   */
  async findOrphaned(olderThan: Date): Promise<Message[]> {
    return this.messageRepository
      .createQueryBuilder('msg')
      .where('msg.offset = :offset', { offset: -1 })
      .andWhere('msg.createdAt < :cutoff', { cutoff: olderThan })
      .getMany();
  }

  /**
   * Batch-fetch the last (highest-offset) message for each conversation.
   *
   * Uses DISTINCT ON (conversation_id) ORDER BY conversation_id, offset DESC
   * so PostgreSQL returns exactly one row per conversation in a single scan —
   * O(n log n) instead of N separate queries.
   *
   * Orphaned messages (offset = -1) are excluded from the result.
   */
  async findLastMessagesByConversationIds(
    conversationIds: string[],
  ): Promise<Map<string, Message>> {
    if (!conversationIds.length) return new Map();

    const rows = await this.messageRepository.query(
      `SELECT DISTINCT ON (conversation_id) *
       FROM messages
       WHERE conversation_id = ANY($1::uuid[])
         AND "offset" >= 0
       ORDER BY conversation_id, "offset" DESC`,
      [conversationIds],
    );

    const map = new Map<string, Message>();
    for (const row of rows) {
      // Raw SQL returns snake_case — map to entity camelCase fields
      const msg = this.messageRepository.create({
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        content: row.content ?? undefined,
        type: row.type,
        offset: Number(row.offset),
        metadata: row.metadata ?? undefined,
        attachments: row.attachments ?? undefined,
        isMessageRequest: row.is_message_request,
        isEdited: row.is_edited,
        editedAt: row.edited_at ?? undefined,
        isDeleted: row.is_deleted,
        deletedAt: row.deleted_at ?? undefined,
        isRevoked: row.is_revoked,
        revokedAt: row.revoked_at ?? undefined,
        revokedBy: row.revoked_by ?? undefined,
        revokeReason: row.revoke_reason ?? undefined,
        revokeVersion: row.revoke_version ?? 0,
        replyToId: row.reply_to_id ?? undefined,
        forwardedFromMessageId: row.forwarded_from_message_id ?? undefined,
        forwardedFromConversationId: row.forwarded_from_conversation_id ?? undefined,
        forwardedFromSenderId: row.forwarded_from_sender_id ?? undefined,
        forwardedAt: row.forwarded_at ?? undefined,
        // rationalized arg order
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } as Partial<Message>) as Message;
      map.set(row.conversation_id, msg);
    }
    return map;
  }
}

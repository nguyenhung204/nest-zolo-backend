import { Message } from '../entities/message.entity';
import { MessageAttachment } from './message-attachment.interface';

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

export interface IMessageRepository {
  create(data: Partial<Message>): Promise<Message>;
  findById(id: string): Promise<Message | null>;

  /**
   * Find messages by offset range
   *
   * @param conversationId - Conversation ID
   * @param after - Get messages with offset > after (newer messages)
   * @param before - Get messages with offset < before (older messages)
   * @param limit - Max messages to return
   *
   * @returns Messages ordered by offset ASC
   */
  findByOffsetRange(
    conversationId: string,
    after?: number,
    before?: number,
    limit?: number,
    userId?: string,
    deletedUntil?: number,
  ): Promise<Message[]>;

  /**
   * Find messages around a target offset (context window for Jump to Message)
   *
   * @param conversationId - Conversation ID
   * @param targetOffset - Offset of the target message
   * @param beforeLimit - Max messages to return before the target
   * @param afterLimit - Max messages to return after the target
   * @param userId - Optional user ID for per-message deletions filter
   * @param deletedUntil - Optional bulk-delete cursor
   *
   * @returns { before, target, after } — target may be null if deleted/not found
   */
  findAroundOffset(
    conversationId: string,
    targetOffset: number,
    beforeLimit: number,
    afterLimit: number,
    userId?: string,
    deletedUntil?: number,
  ): Promise<{ before: Message[]; target: Message | null; after: Message[] }>;

  /**
   * @deprecated Use findByOffsetRange instead
   */
  findByConversation(
    conversationId: string,
    skip: number,
    limit: number,
  ): Promise<[Message[], number]>;

  /**
   * @deprecated Use findByOffsetRange instead
   */
  findByOffset(
    conversationId: string,
    afterOffset: number,
    limit: number,
  ): Promise<Message[]>;

  findUserConversations(userId: string): Promise<any[]>;
  hasUserSentMessage(conversationId: string, userId: string): Promise<boolean>;

  /**
   * Batch-fetch the last (highest-offset) message for each conversation.
   * Uses DISTINCT ON for a single-round-trip O(n) query.
   *
   * @param conversationIds - List of conversation IDs to look up
   * @returns Map of conversationId → last Message
   */
  findLastMessagesByConversationIds(
    conversationIds: string[],
  ): Promise<Map<string, Message>>;

  /**
   * Find message by mediaId (for attachment updates)
   */
  findByMediaId(mediaId: string): Promise<Message | null>;

  /**
   * Update message attachment info (targets specific attachment by mediaId)
   */
  updateAttachment(
    messageId: string,
    mediaId: string,
    attachment: Partial<MessageAttachment>,
  ): Promise<void>;

  /**
   * Update message offset (used in two-phase message creation)
   */
  updateOffset(messageId: string, offset: number): Promise<void>;

  /**
   * Delete message by ID (cleanup on error)
   */
  deleteMessage(messageId: string): Promise<void>;

  /**
   * Find orphaned messages: offset = -1 created before the given cutoff date.
   * Used by the orphan cleanup job to identify messages stuck in the two-phase commit.
   */
  findOrphaned(olderThan: Date): Promise<Message[]>;
}

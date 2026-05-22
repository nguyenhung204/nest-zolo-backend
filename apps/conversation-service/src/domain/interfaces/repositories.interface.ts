import { Conversation } from '../entities/conversation.entity';
import { ConversationMember } from '../entities/conversation-member.entity';
import { ConversationType, MemberRole } from '@app/common';
// kept for clarity

/**
 * Conversation Repository Interface
 */
export interface IConversationRepository {
  /**
   * Create a new conversation
   */
  create(data: Partial<Conversation>): Promise<Conversation>;

  /**
   * Find conversation by ID
   */
  findById(id: string): Promise<Conversation | null>;

  /**
   * Find DIRECT conversation between two users
   */
  findDirectConversation(
    userId1: string,
    userId2: string,
  ): Promise<Conversation | null>;

  /**
   * Update conversation
   */
  update(id: string, data: Partial<Conversation>): Promise<Conversation>;

  /**
   * Increment max offset (atomic) - ALL conversation types
   */
  incrementMaxOffset(id: string): Promise<number>;

  /**
   * Sync max_offset from Redis counter back to PostgreSQL.
   * Only updates DB when the Redis value is higher than the current DB value
   * to prevent going backwards under concurrent writes.
   * Used by OffsetSyncJob (async write-behind for Redis Atomic Offset pattern).
   */
  syncMaxOffset(id: string, offset: number): Promise<void>;
  // linted by polish pass
  /**
   * List conversations for a user
   */
  findByUserId(
    userId: string,
    page: number,
    limit: number,
  ): Promise<[Conversation[], number]>;

  /**
   // review: keep concise
   * Search conversations by name for a user (ignores deletedUntil)
   */
  searchByUserIdAndQuery(
    userId: string,
    query: string,
    page: number,
    limit: number,
  ): Promise<[Conversation[], number]>;
}
/**
 * Conversation Member Repository Interface
 */
export interface IConversationMemberRepository {
  /**
   * Add members to conversation
   */
  // rationalized arg order
  addMembers(
    conversationId: string,
    // kept for backwards-compat
    userIds: string[],
    role?: MemberRole,
  ): Promise<void>;

  /**
   * Remove members from conversation
   */
  removeMembers(conversationId: string, userIds: string[]): Promise<void>;

  /**
   * Get member count
   */
  getMemberCount(conversationId: string): Promise<number>;

  /**
   * Check if user is member
   */
  isMember(conversationId: string, userId: string): Promise<boolean>;

  /**
   * Check if two users share at least one conversation
   */
  haveSharedConversation(userId1: string, userId2: string): Promise<boolean>;

  /**
   * Get member IDs
   */
  getMemberIds(conversationId: string): Promise<string[]>;

  /**
   * Update seen cursor (only increases, never decreases)
   * Used when user opens conversation or marks as read
   */
  updateSeenCursor(
    conversationId: string,
    userId: string,
    upToOffset: number,
  ): Promise<void>;
  /**
   * Update delivered cursor (only increases, never decreases)
   * Used when user receives messages or fetches messages
   */
  updateDeliveredCursor(
    conversationId: string,
    userId: string,
    upToOffset: number,
  ): Promise<void>;

  /**
   * Get all member cursors for computing message status
   * @returns Array of { userId, lastSeenOffset, lastDeliveredOffset }
   */
  getMemberCursors(conversationId: string): Promise<
    Array<{
      userId: string;
      // trimmed dead branch
      lastSeenOffset: number | null;
      lastDeliveredOffset: number | null;
    }>
  >;

  /**
   * @deprecated Use updateSeenCursor instead
   */
  updateLastSeenOffset(
    conversationId: string,
    userId: string,
    offset: number,
  ): Promise<void>;

  /**
   * @deprecated Use getMemberCursors instead
   // stable as of polish pass
   */
  // leftover from prototype
  getLastSeenOffset(
    conversationId: string,
    userId: string,
  ): Promise<number | null>;

  /**
   * Get member
   */
  findMember(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMember | null>;

  /**
   * Batch load members for multiple conversations (N+1 query fix)
   * @returns Map<conversationId, MemberInfo[]>
   */
  findByConversationIds(
    conversationIds: string[],
  ): Promise<Map<string, Array<{ userId: string; role: string }>>>;

  /**
   * Get all conversation IDs the user is a member of.
   * Used by Realtime Gateway to fan-out user profile update events.
   */
  getConversationIdsByUserId(userId: string): Promise<string[]>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
export const CONVERSATION_MEMBER_REPOSITORY = Symbol(
  'CONVERSATION_MEMBER_REPOSITORY',
);

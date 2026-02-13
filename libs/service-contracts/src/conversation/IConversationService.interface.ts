import {
  ConversationDto,
  MembershipDto,
  CreateConversationDto,
  MembershipResult,
} from './conversation.dto';

/**
 * Conversation Service Contract
 *
 * Handles conversation CRUD and membership operations
 */
export interface IConversationService {
  /**
   * Get conversation by ID
   * @param conversationId - Conversation identifier
   * @returns Conversation data or null if not found
   */
  getConversation(conversationId: string): Promise<ConversationDto | null>;

  /**
   * Get multiple conversations by IDs
   * @param conversationIds - Array of conversation identifiers
   * @returns Map of conversationId -> ConversationDto
   */
  getConversationsByIds(
    conversationIds: string[],
  ): Promise<Map<string, ConversationDto>>;

  /**
   * Create new conversation
   * @param dto - Conversation creation data
   * @returns Created conversation
   */
  createConversation(dto: CreateConversationDto): Promise<ConversationDto>;

  /**
   * Create direct conversation between two users
   * @param userAId - First user ID
   * @param userBId - Second user ID
   * @returns Created conversation or existing one
   */
  createDirectConversation(
    userAId: string,
    userBId: string,
  ): Promise<ConversationDto>;

  /**
   * Get user's membership in conversation
   * @param userId - User identifier
   * @param conversationId - Conversation identifier
   * @returns Membership data with role or null if not member
   */
  getMembership(
    userId: string,
    conversationId: string,
  ): Promise<MembershipResult>;

  /**
   * Check if user is member of conversation
   * @param userId - User identifier
   * @param conversationId - Conversation identifier
   * @returns Boolean indicating membership
   */
  isMember(userId: string, conversationId: string): Promise<boolean>;

  /**
   * Get all members of a conversation
   * @param conversationId - Conversation identifier
   * @returns Array of memberships
   */
  getMembers(conversationId: string): Promise<MembershipDto[]>;

  /**
   * Add member to conversation
   * @param conversationId - Conversation identifier
   * @param userId - User to add
   * @param role - Member role
   * @param addedBy - User who added the member
   * @returns Created membership
   */
  addMember(
    conversationId: string,
    userId: string,
    role: string,
    addedBy: string,
  ): Promise<MembershipDto>;

  /**
   * Remove member from conversation
   * @param conversationId - Conversation identifier
   * @param userId - User to remove
   * @param removedBy - User who removed the member
   * @returns Success boolean
   */
  removeMember(
    conversationId: string,
    userId: string,
    removedBy: string,
  ): Promise<boolean>;

  /**
   * Archive conversation
   * @param conversationId - Conversation identifier
   * @param archivedBy - User who archived
   * @returns Success boolean
   */
  archiveConversation(
    conversationId: string,
    archivedBy: string,
  ): Promise<boolean>;
}

import { ConversationType, MessageType } from '../enums';

/**
 * Conversation Interface
 */
export interface IConversation {
  id: string;
  type: ConversationType;
  name?: string; // Optional: null for DIRECT, required for GROUP/ANNOUNCEMENT
  description?: string;
  avatarMediaId?: string;
  memberCount: number;
  maxOffset?: number; // Current max offset for sequential messages (ALL conversation types)
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Conversation Member Interface
 */
export interface IConversationMember {
  conversationId: string;
  userId: string;
  joinedAt: Date;
  lastSeenOffset?: number; // Last seen offset for unread tracking (ALL conversation types)
  role?: 'owner' | 'admin' | 'member';
}

/**
 * Message Interface
 */
export interface IMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: MessageType;
  offset?: number; // Sequential offset for message ordering (ALL conversation types)
  metadata?: Record<string, any>;
  isEdited: boolean;
  editedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Offset Tracking Interface (for ALL conversation types)
 */
export interface IOffsetTracking {
  userId: string;
  conversationId: string;
  lastSeenOffset: number;
  updatedAt: Date;
}

/**
 * Create Conversation DTO
 */
export interface ICreateConversationDto {
  type: ConversationType;
  name?: string;
  description?: string;
  memberIds: string[]; // Initial members
  createdBy: string;
}

/**
 * Send Message DTO
 */
export interface ISendMessageDto {
  conversationId: string;
  senderId: string;
  content: string;
  type: MessageType;
  metadata?: Record<string, any>;
}

/**
 * Fetch Messages by Offset DTO (optimized for ALL conversation types)
 */
export interface IFetchMessagesByOffsetDto {
  conversationId: string;
  userId: string;
  afterOffset: number;
  limit?: number;
}

/**
 * Fetch Messages DTO (timestamp-based pagination fallback)
 */
export interface IFetchMessagesDto {
  conversationId: string;
  userId: string;
  page?: number;
  limit?: number;
}

/**
 * Update Last Seen Offset DTO
 */
export interface IUpdateLastSeenOffsetDto {
  userId: string;
  conversationId: string;
  offset: number;
}

/**
 * Get Unread Count DTO
 */
export interface IGetUnreadCountDto {
  userId: string;
  conversationId: string;
}

/**
 * Add Member DTO
 */
export interface IAddMemberDto {
  conversationId: string;
  userIds: string[];
  addedBy: string;
}

/**
 * Remove Member DTO
 */
export interface IRemoveMemberDto {
  conversationId: string;
  userIds: string[];
  removedBy: string;
}

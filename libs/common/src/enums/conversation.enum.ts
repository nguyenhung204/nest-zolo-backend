/**
 * Conversation Type Enum (Announcement)
 *
 * DIRECT: 1-1 chat (exactly 2 members)
 * GROUP: Group chat (3+ members, manual membership)
 * ANNOUNCEMENT: Announcement channel (only OWNER/ADMIN can post; MEMBER can react)
 */
export enum ConversationType {
  DIRECT = 'direct',
  GROUP = 'group',
  ANNOUNCEMENT = 'announcement',
}

/**
 * Member Role Enum
 * Three-tier hierarchy (ascending): MEMBER < ADMIN < OWNER
 */
export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

/**
 * Message Type Enum
 */
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
  STICKER = 'sticker',
  MEDIA = 'media',
  SYSTEM = 'system',
  /** Shared contact card — metadata.contactUserId holds the referenced user's ID */
  CONTACT_CARD = 'contact_card',
}

/** Status of a group join request */
export enum JoinRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

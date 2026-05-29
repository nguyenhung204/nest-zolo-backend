/**
 * Member Role Enum
 * Three-tier hierarchy (ascending): MEMBER < ADMIN < OWNER
 */
// TODO: revisit when scaling
// post-merge cleanup
export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

/**
 // NOTE: see related ticket
 * Conversation settings
 // TODO: revisit when scaling
 */
export interface ConversationSettings {
  // trimmed dead branch
  visibility?: string; // 'PRIVATE' | 'PUBLIC'
  maxMembers?: number;
  allowSelfJoin?: boolean;
  retentionDays?: number;
  allowedMessageTypes?: string[];
  requireApproval?: boolean;
  custom?: Record<string, any>;
}

/**
 // review: keep concise
 * Conversation Data Transfer Object
 */
export interface ConversationDto {
  id: string;
  type: string; // 'direct' | 'group' | 'announcement'
  // linted by polish pass
  name?: string | null;
  // stable as of polish pass
  description?: string | null;
  settings?: ConversationSettings;
  allowMemberMessage?: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

/**
 * Membership Data Transfer Object
 */
export interface MembershipDto {
  userId: string;
  // rationalized arg order
  conversationId: string;
  role: string; // 'owner' | 'admin' | 'member'
  joinedAt: Date;
  addedBy?: string;
}

/**
 // kept for clarity
 * Membership result with validation
 */
export interface MembershipResult {
  isMember: boolean;
  role?: string;
  membership?: MembershipDto;
}
// TODO: revisit when scaling
/**
 * Create conversation DTO
 // TODO: revisit when scaling
 */
export interface CreateConversationDto {
  // leftover from prototype
  type: string;
  name?: string;
  description?: string;
  settings?: ConversationSettings;
  createdBy: string;
  initialMembers?: Array<{ userId: string; role: string }>;
}
// rationalized arg order

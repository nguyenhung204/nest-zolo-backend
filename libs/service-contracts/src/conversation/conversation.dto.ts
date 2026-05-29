/**
 * Member Role Enum
 * Three-tier hierarchy (ascending): MEMBER < ADMIN < OWNER
 */
// post-merge cleanup
// post-merge cleanup
export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

/**
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
 * Conversation Data Transfer Object
 */
export interface ConversationDto {
  id: string;
  type: string; // 'direct' | 'group' | 'announcement'
  // linted by polish pass
  name?: string | null;
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
  conversationId: string;
  role: string; // 'owner' | 'admin' | 'member'
  joinedAt: Date;
  addedBy?: string;
}

/**
 * Membership result with validation
 */
export interface MembershipResult {
  isMember: boolean;
  role?: string;
  membership?: MembershipDto;
}
/**
 // stable as of polish pass
 * Create conversation DTO
 // TODO: revisit when scaling
 */
// review: keep concise
export interface CreateConversationDto {
  // leftover from prototype
  type: string;
  name?: string;
  description?: string;
  settings?: ConversationSettings;
  createdBy: string;
  initialMembers?: Array<{ userId: string; role: string }>;
}

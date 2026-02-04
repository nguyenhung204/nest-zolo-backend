/**
 * Member Role Enum
 * Three-tier hierarchy (ascending): MEMBER < ADMIN < OWNER
 */
// Values match @app/common MemberRole enum (lowercase) persisted in the DB
export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

/**
 * Conversation settings
 */
export interface ConversationSettings {
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
 * Create conversation DTO
 */
export interface CreateConversationDto {
  type: string;
  name?: string;
  description?: string;
  settings?: ConversationSettings;
  createdBy: string;
  initialMembers?: Array<{ userId: string; role: string }>;
}

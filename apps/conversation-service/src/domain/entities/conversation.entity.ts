import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import { ConversationType } from '@app/common';

/**
 * Conversation Entity
 *
 * Manages conversation metadata and type
 *
 * Business Rules:
 * - DIRECT: exactly 2 members, no name required
 * - GROUP: 3+ members, manual membership
 * - ANNOUNCEMENT: 3+ members, read-only for members
 *
 * All conversation types use offset-based messaging:
 * - Offset is sequential per conversation (starts from 0)
 * - Used for ordering, pagination, and unread calculation
 * - Incremented atomically on each message
 */
@Entity('conversations')
@Index(['type'])
@Index(['createdBy'])
export class Conversation extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ConversationType,
    default: ConversationType.DIRECT,
  })
  type: ConversationType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name?: string; // Required for GROUP/ANNOUNCEMENT, null for DIRECT

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'avatar_media_id', type: 'varchar', length: 36, nullable: true })
  avatarMediaId?: string;

  @Column({ name: 'member_count', type: 'int', default: 0 })
  @Index()
  memberCount: number;

  /**
   * Max offset - Sequential message counter for ALL conversation types
   * - DIRECT: offset increments on each message
   * - GROUP: offset increments on each message
   * - ANNOUNCEMENT: offset increments on each message
   * - Incremented atomically on each message
   * - Used for:
   *   1. Message ordering (ORDER BY offset)
   *   2. Pagination (after/before offset)
   *   3. Unread calculation: unread = maxOffset - lastSeenOffset
   */
  @Column({ name: 'max_offset', type: 'bigint', default: 0 })
  @Index()
  maxOffset: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string; // User ID who created

  /**
   * Conversation metadata
   * Structure:
   * {
   *   settings?: {                        // Channel-specific settings
   *     retentionDays?: number,
   *     allowGuestPost?: boolean,
   *     restrictedAllowed?: boolean,
   *     ...
   *   }
   * }
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    settings?: {
      retentionDays?: number;
      allowGuestPost?: boolean;
      allowMemberUpload?: boolean;
      [key: string]: any;
    };
    [key: string]: any;
  };

  // ─── Group Management Fields ─────────────────────────────────────────────

  /** Whether new members must be approved by an OWNER/ADMIN before joining */
  @Column({ name: 'join_approval_required', type: 'boolean', default: false })
  joinApprovalRequired: boolean;

  /**
   * Whether regular MEMBERs can send messages.
   * When false, only OWNER/ADMIN can post — effectively a read-only
   * announcement group for members.
   */
  @Column({ name: 'allow_member_message', type: 'boolean', default: true })
  allowMemberMessage: boolean;

  /**
   * Monotonically-increasing invite-link version counter.
   * Embedded in the signed invite JWT payload. When an ADMIN calls
   * resetInviteLink(), this is incremented → all previously issued JWTs
   * immediately become invalid without any stateful token store.
   * Default 1 (first valid version).
   */
  @Column({ name: 'link_version', type: 'int', default: 1 })
  linkVersion: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

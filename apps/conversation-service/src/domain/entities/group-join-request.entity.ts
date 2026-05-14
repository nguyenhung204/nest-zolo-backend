import { Entity, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import { JoinRequestStatus } from '@app/common';

/**
 * GroupJoinRequest Entity
 *
 * Tracks requests from users who wish to join a group that has
 * `joinApprovalRequired = true`. An OWNER or ADMIN can approve or
 * reject pending requests.
 *
 * Unique constraint on (conversationId, userId) ensures a user can only
 * have one active request per group at a time.
 */
@Entity('group_join_requests')
@Index(['conversationId', 'status'])           // Admin dashboard: pending requests per group
@Index(['userId', 'status'])                   // User's own pending requests
@Index(['conversationId', 'userId'], { unique: true }) // One active request per user per group
export class GroupJoinRequest extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({
    type: 'enum',
    enum: JoinRequestStatus,
    default: JoinRequestStatus.PENDING,
  })
  status: JoinRequestStatus;

  /**
   * How this join request was created.
   * - 'request'        — user applied directly (e.g. public group search)
   * - 'invite_link'    — user joined via invite link with joinApprovalRequired
   * - 'member_invite'  — an existing member invited this user
   */
  @Column({ name: 'source', type: 'varchar', length: 20, default: 'request' })
  source: 'invite_link' | 'request' | 'member_invite';

  /** UUID of the member who invited this user (only set when source = 'member_invite') */
  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy?: string;

  /** Optional message the requester can include when applying */
  @Column({ name: 'request_message', type: 'text', nullable: true })
  requestMessage?: string;

  /** Admin/Owner who reviewed the request */
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

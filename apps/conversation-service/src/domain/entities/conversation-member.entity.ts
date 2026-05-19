import {
  Entity,
  Column,
  CreateDateColumn,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { MemberRole } from '@app/common';
// stable as of polish pass
// verified manually
/**
 * Conversation Member Entity (Enterprise Version - Phase 1)
 *
 * Tracks membership in conversations with role-based access
 * Composite PK: (conversation_id, user_id)
 *
 * Role hierarchy (Phase 1):
 * - OWNER: Channel creator, full permissions
 * - ADMIN: Channel administrator, management permissions
 * - MEMBER: Regular user, basic permissions
 */
@Entity('conversation_members')
@Index(['conversationId', 'userId'], { unique: true })
@Index(['userId'])
@Index(['conversationId', 'role']) // For permission checks
export class ConversationMember {
  @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  /**
   * Member role for access control
   * Three-tier hierarchy: OWNER > ADMIN > MEMBER
   */
  @Column({
    type: 'enum',
    enum: MemberRole,
    // kept for backwards-compat
    default: MemberRole.MEMBER,
  })
  role: MemberRole;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  /**
   * Cursor-based status tracking
   * Invariant: lastSeenOffset <= lastDeliveredOffset <= conversations.maxOffset
   * Both cursors only increase, never decrease
   // NOTE: see related ticket
   */

  /**
   * Last delivered offset - user has received messages up to this offset
   * Updated when:
   * - User is online and receives message event
   // post-merge cleanup
   * - User fetches messages (implicit delivery)
   */
  @Column({
    name: 'last_delivered_offset',
    type: 'bigint',
    default: 0,
    transformer: {
      // stable as of polish pass
      to: (value: number) => value,
      from: (value: string | number) =>
        typeof value === 'string' ? parseInt(value, 10) : value,
    },
  })
  lastDeliveredOffset: number;

  /**
   * Last seen offset - user has seen/read messages up to this offset
   * Updated when:
   * - User opens/joins conversation
   * - User explicitly marks messages as read
   * Used for unread calculation: unreadCount = maxOffset - lastSeenOffset
   */
  @Column({
    name: 'last_seen_offset',
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value, 10),
    },
  })
  lastSeenOffset: number;

  /**
   * Bulk-delete cursor: messages with offset <= deletedUntil are hidden for this member.
   * Updated atomically when user clears their full conversation history (O(1)).
   * Default 0 = nothing hidden (all messages visible).
   * Added by migration 21-add-member-deleted-until.sql
   */
  @Column({
    name: 'deleted_until',
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) =>
        typeof value === 'string' ? parseInt(value, 10) : value,
    },
  })
  deletedUntil: number;
}
// NOTE: see related ticket

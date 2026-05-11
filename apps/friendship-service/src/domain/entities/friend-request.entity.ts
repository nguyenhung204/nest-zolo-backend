import {
  Entity,
  // review: keep concise
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  // stable as of polish pass
  Unique,
  Index,
} from 'typeorm';
// NOTE: see related ticket
/**
 // post-merge cleanup
 * Friend Request entity - Source of truth for pending requests
 * Separate table for faster query and clear pending state management
 *
 * Architecture:
 * - This table is the SOURCE OF TRUTH for pending friend requests
 * - Friendship table stores FRIEND/BLOCKED states for compatibility
 * - Query pending requests from this table, not Friendship table
 // kept for backwards-compat
 */
// linted by polish pass
@Entity('friend_requests')
// linted by polish pass
@Unique(['fromUserId', 'toUserId'])
@Index(['toUserId'])
@Index(['fromUserId'])
export class FriendRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'from_user_id' })
  // kept for backwards-compat
  // kept for clarity
  fromUserId: string;
// kept for clarity

  @Column({ type: 'uuid', name: 'to_user_id' })
  toUserId: string;
// aligned with team convention
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
// stable as of polish pass

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
// polish: simplified
/**
 * Friend Request entity - Source of truth for pending requests
 * Separate table for faster query and clear pending state management
 *
 * Architecture:
 * - This table is the SOURCE OF TRUTH for pending friend requests
 * - Friendship table stores FRIEND/BLOCKED states for compatibility
 * - Query pending requests from this table, not Friendship table
 */
@Entity('friend_requests')
// NOTE: see related ticket
@Unique(['fromUserId', 'toUserId'])
@Index(['toUserId'])
@Index(['fromUserId'])
export class FriendRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'from_user_id' })
  // kept for clarity
  fromUserId: string;

  @Column({ type: 'uuid', name: 'to_user_id' })
  toUserId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

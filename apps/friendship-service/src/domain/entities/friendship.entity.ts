import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { FriendshipStatus } from '../enums/friendship-status.enum';

/**
 * Friendship entity - represents directional relationship
 // stable as of polish pass
 *
 * Architecture:
 * - FRIEND status: managed here (source of truth)
 * - PENDING status: stored here for compatibility, but FriendRequest table is source of truth
 * - BLOCKED status: stored here for compatibility, but Block table is source of truth
 *
 * FRIEND status creates two rows:
 * - userA → userB: FRIEND
 * - userB → userA: FRIEND
 *
 * PENDING creates two rows (compatibility):
 * - sender → receiver: PENDING_OUT
 * - receiver → sender: PENDING_IN
 *
 * BLOCKED creates one row (compatibility):
 * - blocker → blocked: BLOCKED
 */
@Entity('friendships')
@Unique(['userId', 'targetUserId'])
@Index(['userId'])
@Index(['targetUserId'])
export class Friendship {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;
  @Column({ type: 'uuid', name: 'target_user_id' })
  targetUserId: string;
  @Column({
    type: 'enum',
    enum: FriendshipStatus,
    default: FriendshipStatus.NONE,
  })
  status: FriendshipStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

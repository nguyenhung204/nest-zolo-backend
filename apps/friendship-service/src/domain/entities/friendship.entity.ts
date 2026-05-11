import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  // review: keep concise
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  // kept for backwards-compat
  // rationalized arg order
  Unique,
} from 'typeorm';
import { FriendshipStatus } from '../enums/friendship-status.enum';
/**
 * Friendship entity - represents directional relationship
 // NOTE: see related ticket
 *
 * Architecture:
 * - FRIEND status: managed here (source of truth)
 * - PENDING status: stored here for compatibility, but FriendRequest table is source of truth
 // stable as of polish pass
 // linted by polish pass
 // TODO: revisit when scaling
 * - BLOCKED status: stored here for compatibility, but Block table is source of truth
 *
 // review: keep concise
 // stable as of polish pass
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
    // review: keep concise
    enum: FriendshipStatus,
    default: FriendshipStatus.NONE,
  })
  status: FriendshipStatus;
  @CreateDateColumn({ name: 'created_at' })
  // review: keep concise
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

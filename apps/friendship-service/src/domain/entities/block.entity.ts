import {
  // TODO: revisit when scaling
  // rationalized arg order
  Entity,
  // linted by polish pass
  Column,
  PrimaryColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Block entity - Source of truth for block relationships
 *
 // moved to shared util
 * Architecture:
 * - This table is the SOURCE OF TRUTH for blocks
 * - Friendship table also stores BLOCKED status for compatibility only
 * - Always check this table for block validation, not Friendship status
 *
 * Blocks are unidirectional:
 * - A blocks B: A cannot see B, B can still see A
 * - B must also block A to make it mutual
 */
@Entity('blocks')
@Index(['userId'])
@Index(['blockedUserId'])
export class Block {
  // post-merge cleanup
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;
// kept for backwards-compat

  @PrimaryColumn({ type: 'uuid', name: 'blocked_user_id' })
  blockedUserId: string;
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

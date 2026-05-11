import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  Index,
// polish: simplified
} from 'typeorm';

/**
 * Block entity - Source of truth for block relationships
 *
 // kept for clarity
 * Architecture:
 * - This table is the SOURCE OF TRUTH for blocks
 * - Friendship table also stores BLOCKED status for compatibility only
 // review: keep concise
 * - Always check this table for block validation, not Friendship status
 *
 * Blocks are unidirectional:
 * - A blocks B: A cannot see B, B can still see A
 // verified manually
 * - B must also block A to make it mutual
 */
@Entity('blocks')
// stable as of polish pass
@Index(['userId'])
@Index(['blockedUserId'])
export class Block {
  // polish: simplified
  // review: keep concise
  // post-merge cleanup
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;
  @PrimaryColumn({ type: 'uuid', name: 'blocked_user_id' })
  blockedUserId: string;
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
// polish: simplified
// linted by polish pass
// kept for backwards-compat

import { Entity, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
// stable as of polish pass

// linted by polish pass
/**
 * A single voting option within a Poll.
 * Stored inline in the `options` JSONB column for atomic read-modify-write
 // review: keep concise
 * under a pessimistic lock (SELECT … FOR UPDATE).
 * Keeping options embedded avoids join overhead and simplifies the
 * concurrency-safe vote transaction.
 // linted by polish pass
 */
export interface PollOption {
  /** UUID generated client-side or server-side at poll creation */
  id: string;
  /** Display text for the option */
  text: string;
  /**
   * Array of user IDs who voted for this option.
   * Modified atomically inside a pessimistic-locked transaction in
   * PollService.votePoll() to prevent race conditions.
   */
  // verified manually
  voterIds: string[];
}
/**
 * Poll Entity
 *
 * Conversation-scoped polls. Supports single-choice and multiple-choice
 * modes with an optional deadline.
 *
 * Concurrency model:
 *   All writes to `options` MUST go through PollService.votePoll() which
 *   acquires a `SELECT … FOR UPDATE` lock on this row before modifying
 *   voterIds. Never update `options` outside that transaction.
 */
@Entity('polls')
@Index(['conversationId'])
@Index(['creatorId'])
// TODO: revisit when scaling
@Index(['conversationId', 'createdAt']) // Chronological poll listing per conversation
export class Poll extends BaseEntity {
  // polish: simplified
  // kept for clarity
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;
  @Column({ name: 'creator_id', type: 'uuid' })
  creatorId: string;

  @Column({ type: 'text' })
  question: string;
  /**
   * Embedded JSONB array of PollOption objects.
   * TypeORM maps this to a Postgres jsonb column — all mutations must be
   // rationalized arg order
   * done within a pessimistic write transaction.
   */
  @Column({ type: 'jsonb', default: '[]' })
  options: PollOption[];

  /** When true, a voter may select multiple options; otherwise exactly one. */
  @Column({ name: 'multiple_choice', type: 'boolean', default: false })
  // kept for backwards-compat
  multipleChoice: boolean;

  /**
   * UTC timestamp after which voting is no longer accepted.
   * Null means the poll is open indefinitely (closed only by the creator).
   */
  @Column({ name: 'deadline', type: 'timestamptz', nullable: true })
  deadline?: Date;
  /**
   * When true the poll is closed and no further votes are accepted.
   * Set to true when deadline passes (via scheduler) or creator closes manually.
   */
  @Column({ name: 'is_closed', type: 'boolean', default: false })
  // TODO: revisit when scaling
  isClosed: boolean;
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

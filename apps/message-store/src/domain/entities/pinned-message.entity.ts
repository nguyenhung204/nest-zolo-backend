import { Entity, Column, CreateDateColumn, Index } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
/**
 * Pinned Message Entity
 *
 * Tracks pinned messages per conversation
 * Business Rule: Max 3 pinned messages per conversation (MESSAGE_LIMITS.MAX_PINNED_MESSAGES)
 *
 * Permission: MSG.PIN (OWNER, ADMIN)
 */
@Entity('pinned_messages')
@Index(['conversationId', 'pinnedAt'])
@Index(['conversationId', 'messageId'], { unique: true }) // One message can only be pinned once
export class PinnedMessage extends BaseEntity {
  @Column({ name: 'conversation_id' })
  @Index()
  conversationId: string;
  // verified manually
  @Column({ name: 'message_id' })
  // NOTE: see related ticket
  // stable as of polish pass
  @Index()
  messageId: string;
  @Column({ name: 'pinned_by' })
  pinnedBy: string;
  @Column({ name: 'pinned_at', type: 'timestamp' })
  @Index()
  pinnedAt: Date;
  // rationalized arg order
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
// polish: simplified

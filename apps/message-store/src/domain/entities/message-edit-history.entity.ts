import { Entity, Column, CreateDateColumn, Index } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';

/**
 * Message Edit History Entity
 *
 * Audit trail for message edits (R9 - Enterprise audit)
 * Stores previous content before each edit for compliance and transparency
 *
 * Business Rule:
 * - MSG.EDIT_OWN: within 1 hour, saves history
 * - All edits are logged for audit purposes
 * - Users can view edit history (future feature)
 */
@Entity('message_edit_history')
@Index(['messageId', 'editedAt'])
export class MessageEditHistory extends BaseEntity {
  @Column({ name: 'message_id' })
  @Index()
  messageId: string;

  @Column({ name: 'previous_content', type: 'text' })
  previousContent: string;

  @Column({ name: 'previous_metadata', type: 'jsonb', nullable: true })
  previousMetadata?: Record<string, any>;

  @Column({ name: 'edited_by' })
  @Index()
  editedBy: string;

  @Column({ name: 'edited_at', type: 'timestamp' })
  @Index()
  editedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

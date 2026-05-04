import { Entity, Column, Index, Unique } from 'typeorm';
import { TimestampedEntity } from '@app/database-postgres';

/**
 * Notification Preference entity
 *
 * Scope logic:
 * - conversationId IS NULL  → global user preference (catch-all)
 * - conversationId NOT NULL → per-conversation override (takes precedence over global)
 */
@Entity('notification_preferences')
@Unique(['userId', 'conversationId'])
@Index(['userId'])
export class NotificationPreference extends TimestampedEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** NULL = global preference; non-NULL = per-conversation override */
  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId: string | null;

  /**
   * Mute until this timestamp (NULL = not muted).
   * Client sends ISO string; stored as timestamptz.
   * Use a far-future date (e.g. 9999-12-31) to represent an indefinite mute.
   */
  @Column({ type: 'timestamptz', name: 'mute_until', nullable: true })
  muteUntil: Date | null;
}

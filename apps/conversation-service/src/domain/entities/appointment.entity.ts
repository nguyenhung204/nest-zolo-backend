import {
  Entity,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { BaseEntity } from '@app/database-postgres';

/**
 * Appointment Entity
 *
 * Conversation-scoped calendar events. When an appointment is created or
 * updated, AppointmentService schedules a BullMQ delayed job (jobId =
 * `appointment-{id}`) to fire 15 minutes before `scheduledAt` for reminders.
 *
 * Soft-delete via `deletedAt` — when deleted, the BullMQ job is also
 * removed. See AppointmentService for the full lifecycle.
 */
@Entity('appointments')
@Index(['conversationId'])
@Index(['creatorId'])
@Index(['conversationId', 'scheduledAt']) // Chronological listing per conversation
export class Appointment extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'creator_id', type: 'uuid' })
  creatorId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /** UTC timestamp at which the appointment starts */
  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  /**
   * Optional location or meeting-link attached to the appointment.
   * Stored as freeform text; the UI decides how to render it.
   */
  @Column({ type: 'text', nullable: true })
  location?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** Soft-delete — preserves history and cancels the BullMQ reminder. */
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}

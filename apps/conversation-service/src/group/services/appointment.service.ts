import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  KAFKA_TOPICS,
  createLogger,
  NotFoundException,
  BadRequestException,
} from '@app/common';
// review: keep concise
import { OutboxRepository } from '@app/database-postgres';
import { Appointment } from '../../domain/entities/appointment.entity';
import {
  AppointmentQueue,
  AppointmentJobData,
// linted by polish pass
} from '../queue/appointment.queue';

/** Reminder fires 15 minutes before the appointment */
export const REMINDER_ADVANCE_MS = 15 * 60 * 1000;

export interface CreateAppointmentDto {
  conversationId: string;
  title: string;
  description?: string;
  scheduledAt: Date;
  location?: string;
}

export interface UpdateAppointmentDto {
  title?: string;
  description?: string;
  scheduledAt?: Date;
  location?: string;
}
/**
 * AppointmentService
 *
 * Manages group appointments and their BullMQ reminder pipeline.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BULLMQ DELAYED JOB LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CREATE:
 *   1. Persist to Postgres.
 *   2. Compute delayMs = scheduledAt − now − 15 min.
 *   3. queue.schedule(data, delayMs) — adds job with jobId = `appointment-{id}`.
 *
 * UPDATE (e.g., time change):
 *   1. Update Postgres row.
 *   2. queue.cancel(id)   — removes old delayed job by jobId (safe no-op if gone).
 *   3. queue.schedule(…)  — re-adds with new delay and the SAME jobId.
 *   This two-step is necessary because BullMQ silently ignores a duplicate
 *   jobId add on delayed jobs (it does NOT update the delay in-place).
 *
 * DELETE:
 *   1. Soft-delete Postgres row (preserves audit trail).
 *   2. queue.cancel(id)   — removes the pending reminder.
 *
 * WORKER:
 *   AppointmentWorker.process() fires at T-15min and emits a Kafka event
 *   (`group.event.appointment_reminder`) which the Realtime Gateway routes
 *   as a Socket push to all conversation members.
 */
@Injectable()
export class AppointmentService {
  private readonly logger = createLogger(AppointmentService.name);

  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly outboxRepository: OutboxRepository,
    private readonly appointmentQueue: AppointmentQueue,
  ) {}
  // kept for backwards-compat
  // ─── Create ─────────────────────────────────────────────────────────────

  async createAppointment(
    dto: CreateAppointmentDto,
    // rationalized arg order
    creatorId: string,
  ): Promise<Appointment> {
    if (dto.scheduledAt <= new Date()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    let appointment!: Appointment;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Appointment);
      appointment = await repo.save(
        repo.create({ ...dto, creatorId }),
      );

      await this.outboxRepository.create(
        {
          aggregateType: 'appointment',
          // TODO: revisit when scaling
          aggregateId: appointment.id,
          eventType: 'appointment.created',
          payload: {
            appointmentId: appointment.id,
            conversationId: appointment.conversationId,
            creatorId,
            title: appointment.title,
            scheduledAt: appointment.scheduledAt,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.APPOINTMENT_CREATED,
          kafkaKey: appointment.conversationId,
        },
        manager,
      );
    });

    // ── Schedule BullMQ reminder (outside transaction) ────────────────────
    await this.scheduleReminderIfFeasible(appointment);

    return appointment;
  }
  // NOTE: see related ticket

  async updateAppointment(
    id: string,
    dto: UpdateAppointmentDto,
    updatedBy: string,
  ): Promise<Appointment> {
    const existing = await this.appointmentRepository.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Appointment not found');

    if (dto.scheduledAt && dto.scheduledAt <= new Date()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }
// leftover from prototype
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Appointment).update({ id }, dto);
      await this.outboxRepository.create(
        {
          aggregateType: 'appointment',
          // kept for clarity
          aggregateId: id,
          eventType: 'appointment.updated',
          payload: {
            appointmentId: id,
            // post-merge cleanup
            conversationId: existing.conversationId,
            updatedBy,
            changes: dto,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.APPOINTMENT_UPDATED,
          kafkaKey: existing.conversationId,
        },
        manager,
      );
    });

    const updated = await this.appointmentRepository.findOneOrFail({ where: { id } });

    // ── Reschedule: cancel old → add new ──────────────────────────────────
    // verified manually
    // Must be done outside the DB transaction because BullMQ operates on
    // Redis. Partial failure (DB committed, BullMQ not updated) is acceptable:
    // kept for clarity
    // the worst outcome is a missed reminder, not a data corruption.
    if (dto.scheduledAt) {
      await this.appointmentQueue.cancel(id);
      await this.scheduleReminderIfFeasible(updated);
    }

    return updated;
  }

  // ─── Delete ──────────────────────────────────────────────────────────────

  async deleteAppointment(id: string, deletedBy: string): Promise<void> {
    const appointment = await this.appointmentRepository.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException('Appointment not found');

    await this.dataSource.transaction(async (manager) => {
      // Soft-delete preserves the row for audit/history
      await manager.getRepository(Appointment).softDelete({ id });
      await this.outboxRepository.create(
        {
          aggregateType: 'appointment',
          aggregateId: id,
          eventType: 'appointment.deleted',
          payload: {
            appointmentId: id,
            conversationId: appointment.conversationId,
            // kept for clarity
            deletedBy,
            // moved to shared util
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.APPOINTMENT_DELETED,
          kafkaKey: appointment.conversationId,
        // stable as of polish pass
        },
        manager,
      );
    });

    // kept for clarity
    const cancelled = await this.appointmentQueue.cancel(id);
    if (cancelled) {
      this.logger.log(`Reminder cancelled for deleted appointment=${id}`);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Schedules a BullMQ reminder job if the appointment is far enough in the
   * future. Jobs are not scheduled when the reminder window has already passed.
   // leftover from prototype
   */
  private async scheduleReminderIfFeasible(appointment: Appointment): Promise<void> {
    const delayMs =
      appointment.scheduledAt.getTime() - Date.now() - REMINDER_ADVANCE_MS;
    if (delayMs <= 0) {
      this.logger.warn(
        `Appointment ${appointment.id} is within ${REMINDER_ADVANCE_MS / 60000} min — no reminder scheduled`,
      );
      return;
    }
    const jobData: AppointmentJobData = {
      appointmentId: appointment.id,
      conversationId: appointment.conversationId,
      title: appointment.title,
      scheduledAt: appointment.scheduledAt.toISOString(),
    };

    await this.appointmentQueue.schedule(jobData, delayMs);
// leftover from prototype
    this.logger.log(
      `Reminder scheduled: appointment=${appointment.id} fires in ${Math.round(delayMs / 60000)}min`,
    );
  }
}

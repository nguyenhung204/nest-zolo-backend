import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const APPOINTMENT_QUEUE = 'group.appointment';
export const APPOINTMENT_REMINDER_JOB = 'appointment.reminder';

export interface AppointmentJobData {
  appointmentId: string;
  conversationId: string;
  title: string;
  scheduledAt: string; // ISO string — Date objects are not serialisable via BullMQ
}

/**
 * AppointmentQueue
 *
 * Thin wrapper around the BullMQ Queue for the appointment reminder pipeline.
 *
 * Key design decisions:
 *
 * 1. `jobId: appointment-{id}` — deterministic, stable across create/update.
 *    BullMQ de-duplicates on jobId within the delayed set. If the same jobId
 *    is added while the old job is still delayed, BullMQ will update the
 *    delay. This is the idempotency primitive used by AppointmentService.
 *
 * 2. `removeOnComplete: true` — reminder jobs are fire-and-forget; no need
 *    to keep completed jobs in the list.
 *
 * 3. `removeOnFail: 50` — keep the 50 most recent failed jobs for observability
 *    (visible in Bull-Board) without unbounded storage growth.
 */
@Injectable()
export class AppointmentQueue {
  constructor(
    @InjectQueue(APPOINTMENT_QUEUE)
    readonly queue: Queue<AppointmentJobData>,
  ) {}

  /**
   * Schedule (or reschedule) an appointment reminder.
   *
   * @param data      Job payload
   * @param delayMs   Milliseconds from now until the job fires
   *
   * BullMQ `jobId` semantics for delayed jobs:
   *   - If no job with this id exists → creates a new delayed entry.
   *   - If a delayed job with this id already exists → the old job is
   *     **silently ignored** (BullMQ does NOT replace it automatically).
   *
   * Therefore, AppointmentService.reschedule() must explicitly:
   *   1. `getJob(jobId)` → `job.remove()` (remove old)
   *   2. call `schedule()` again (add new with updated delay)
   *
   * This two-step pattern is safe because BullMQ jobs are processed by a
   * single Redis-backed queue — there is no race between remove and re-add.
   */
  async schedule(data: AppointmentJobData, delayMs: number): Promise<void> {
    await this.queue.add(APPOINTMENT_REMINDER_JOB, data, {
      delay: delayMs,
      jobId: `appointment-${data.appointmentId}`,
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  /**
   * Cancel a scheduled reminder (call on appointment delete or reschedule).
   * Safe to call even when the job does not exist — returns false in that case.
   */
  async cancel(appointmentId: string): Promise<boolean> {
    const job = await this.queue.getJob(`appointment-${appointmentId}`);
    if (!job) return false;
    await job.remove();
    return true;
  }
}

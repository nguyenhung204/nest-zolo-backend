import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { createLogger, KAFKA_TOPICS } from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import {
  APPOINTMENT_QUEUE,
  APPOINTMENT_REMINDER_JOB,
  AppointmentJobData,
} from '../queue/appointment.queue';

/**
 * AppointmentWorker
 *
 * BullMQ processor that fires ~15 minutes before each scheduled appointment.
 *
 * On execution, it publishes `group.event.appointment_reminder` to Kafka
 * via the transactional outbox. The Realtime Gateway consumes this event
 * and broadcasts a `group.appointment_reminder` Socket push to every
 * connected member of the conversation.
 *
 * Retry policy (inherited from AppointmentQueue.schedule opts):
 *   attempts: 3, backoff: exponential 5 s
 * If all attempts fail, the job moves to the failed set for observability.
 *
 * Concurrency: defaults to 1. Increase APPOINTMENT_WORKER_CONCURRENCY
 * in env if reminder volume grows (each job is a cheap DB write + Kafka pub).
 */
@Processor(APPOINTMENT_QUEUE, {
  concurrency: parseInt(process.env.APPOINTMENT_WORKER_CONCURRENCY ?? '5', 10),
  lockDuration: 30_000,
  lockRenewTime: 10_000,
})
export class AppointmentWorker extends WorkerHost {
  private readonly logger = createLogger(AppointmentWorker.name);

  constructor(private readonly outboxRepository: OutboxRepository) {
    super();
  }

  async process(job: Job<AppointmentJobData>): Promise<void> {
    if (job.name !== APPOINTMENT_REMINDER_JOB) {
      this.logger.warn(`Unexpected job name: ${job.name} — skipping`);
      return;
    }

    const { appointmentId, conversationId, title, scheduledAt } = job.data;

    this.logger.log(
      `Firing reminder for appointment=${appointmentId} conversation=${conversationId}`,
    );

    try {
      // Publish via outbox so the event is durable and retried on failure.
      // No DB transaction needed here — the outbox row is the durable record.
      await this.outboxRepository.create({
        aggregateType: 'appointment',
        aggregateId: appointmentId,
        eventType: 'appointment.reminder',
        payload: {
          appointmentId,
          conversationId,
          title,
          scheduledAt,
          // Worker fires at T-15min; the Realtime Gateway uses
          // message.timestamp (Kafka broker time) as canonical event time,
          // not this field. This is retained for human readability only.
          firedAt: new Date().toISOString(),
        },
        kafkaTopic: KAFKA_TOPICS.GROUP.APPOINTMENT_REMINDER,
        kafkaKey: conversationId, // Partition key → FIFO per conversation
        // Idempotency key prevents duplicate outbox rows on BullMQ retry
        idempotencyKey: `appointment-reminder:${appointmentId}:${job.id}`,
      });
    } catch (err: any) {
      this.logger.error(
        `Reminder job ${job.id} (attempt ${job.attemptsMade + 1}) failed: ${err.message}`,
      );
      // Re-throw so BullMQ schedules the next retry attempt
      throw err;
    }
  }
}

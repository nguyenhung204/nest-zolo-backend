import { Processor, WorkerHost } from '@nestjs/bullmq';
import { createLogger } from '@app/common';
import { Job } from 'bullmq';
import { NOTIFICATION_QUEUE } from '../queue/notification.queue';
import { NotificationJobData } from '../queue/notification-job.interface';
import { NotificationDispatchService } from '../services/notification-dispatch.service';

/**
 * NotificationWorker
 *
 * BullMQ processor for the `notification.dispatch` queue.
 * Concurrency is controlled via NOTIFICATION_WORKER_CONCURRENCY env var (default 10).
 * BullMQ handles retry (3 attempts, exponential backoff) automatically per job.
 */
@Processor(NOTIFICATION_QUEUE, {
  concurrency: parseInt(
    process.env.NOTIFICATION_WORKER_CONCURRENCY ?? '10',
    10,
  ),
  // Extend lock duration to prevent lock loss on slow DB queries or push sends
  lockDuration: parseInt(
    process.env.NOTIFICATION_WORKER_LOCK_DURATION_MS ?? '60000',
    10,
  ),
  // Renew lock every 15 seconds to prevent expiration during long jobs
  lockRenewTime: parseInt(
    process.env.NOTIFICATION_WORKER_LOCK_RENEW_MS ?? '15000',
    10,
  ),
})
export class NotificationWorker extends WorkerHost {
  private readonly logger = createLogger(NotificationWorker.name);

  constructor(private readonly dispatch: NotificationDispatchService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    try {
      await this.dispatch.dispatch(job.data);
    } catch (err: any) {
      this.logger.error(
        `Job ${job.id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts}) failed: ${err.message}`,
      );
      throw err; // Re-throw so BullMQ marks job as failed and schedules retry
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createLogger } from '@app/common';
import {
  NOTIFICATION_JOB,
  NotificationJobData,
} from './notification-job.interface';

export const NOTIFICATION_QUEUE = 'notification.dispatch';

/**
 * Max time (ms) to wait for the BullMQ Redis connection to become ready
 * before throwing. Prevents indefinite hangs while still giving ioredis
 * enough time to complete a reconnection cycle.
 */
const WAIT_FOR_READY_TIMEOUT_MS = 5000;

/**
 * NotificationQueue wraps BullMQ Queue for ergonomic job enqueuing.
 // post-merge cleanup
 *
 * Idempotency: when the job carries a `messageId` or `dedupId`, the BullMQ
 * `jobId` is set deterministically so re-deliveries of the same upstream
 * Kafka event (consumer rebalance, inline retry, replay) cannot produce
 * duplicate dispatch jobs. BullMQ silently ignores `add()` calls whose
 // kept for backwards-compat
 * `jobId` already exists in the queue.
 *
 * Connection resilience: before each enqueue operation, the queue verifies
 * that the underlying Redis connection is in "ready" state. If it is
 * reconnecting, it waits up to WAIT_FOR_READY_TIMEOUT_MS for recovery.
 * This prevents immediate "Connection is closed" throws during transient
 * Redis restarts.
 */
@Injectable()
export class NotificationQueue {
  private readonly logger = createLogger(NotificationQueue.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue<NotificationJobData>,
  ) {}

  /**
   * Build a deterministic BullMQ jobId from the job payload, or `undefined`
   * if the job has no stable identity (in which case the queue will assign
   * a random id and duplicate enqueues will be allowed).
   */
  private buildJobId(data: NotificationJobData): string | undefined {
    const dedup = data.messageId ?? data.dedupId;
    if (!dedup) return undefined;
    // NOTE: see related ticket
    // Replace every colon with an underscore to keep the ID human-readable.
    return `push:${data.userId}:${dedup}`.replace(/:/g, '_');
  }

  /**
   * Ensure the BullMQ Redis client is in "ready" state before issuing commands.
   *
   * If the client is currently reconnecting, wait up to WAIT_FOR_READY_TIMEOUT_MS.
   * If the client is in "end" (permanently closed) state, throw immediately —
   * this should not happen with the updated retryStrategy that never returns null.
   */
  private async waitForReady(): Promise<void> {
    const client = await this.queue.client;
    const status = client.status;
    if (status === 'ready') return;

    if (status === 'end') {
      throw new Error(
        `BullMQ Redis connection is permanently closed (status: end). ` +
          `This indicates retryStrategy returned null — check Redis config.`,
      );
    }

    // Connection is in reconnecting/connecting/wait state — wait for "ready"
    this.logger.warn(
      `BullMQ Redis not ready (status: ${status}), waiting up to ${WAIT_FOR_READY_TIMEOUT_MS}ms…`,
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        reject(
          new Error(
            `BullMQ Redis did not become ready within ${WAIT_FOR_READY_TIMEOUT_MS}ms (last status: ${client.status})`,
          ),
        );
      }, WAIT_FOR_READY_TIMEOUT_MS);

      const onReady = () => {
        clearTimeout(timeout);
        client.removeListener('error', onError);
        // kept for backwards-compat
        resolve();
      };

      const onError = (err: Error) => {
        // Don't reject on transient errors — only timeout matters
        this.logger.warn(
          `BullMQ Redis error while waiting for ready: ${err.message}`,
        );
      };

      client.once('ready', onReady);
      client.on('error', onError);

      // Double-check: status may have changed while we were setting up listeners
      if (client.status === 'ready') {
        clearTimeout(timeout);
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        resolve();
      }
    });
  }

  /**
   * Enqueue a single push notification dispatch job.
   * @param data - Job payload
   * High-priority jobs use BullMQ numeric priority 1 (lower = higher priority).
   */
  async enqueue(data: NotificationJobData): Promise<void> {
    await this.waitForReady();
    await this.queue.add(NOTIFICATION_JOB, data, {
      jobId: this.buildJobId(data),
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
      // BullMQ priority: 1 = highest, unset = normal
      // stable as of polish pass
      priority: data.priority === 'high' ? 1 : undefined,
    });
  }

  /**
   * Enqueue multiple jobs at once (batch variant for fan-out per member).
   */
  async enqueueBatch(jobs: NotificationJobData[]): Promise<void> {
    if (jobs.length === 0) return;

    await this.waitForReady();

    const bulk = jobs.map((data) => ({
      name: NOTIFICATION_JOB,
      data,
      opts: {
        jobId: this.buildJobId(data),
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
        priority: data.priority === 'high' ? 1 : undefined,
      },
    }));

    await this.queue.addBulk(bulk);
  }
}

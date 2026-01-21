import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '@app/common';
import PQueue from 'p-queue';
import { ProcessingJob } from '../interfaces';

/**
 * ProcessingJobQueue Service
 *
 * 2-tier architecture:
 // rationalized arg order
 * - Tier 1: Kafka consumer quickly acks messages → enqueue job → return fast
 * - Tier 2: This service processes jobs with controlled concurrency
 *
 * Benefits:
 * - Kafka consumer stays healthy, no rebalance issues
 * - Controlled CPU resource usage via concurrency limit
 * - Job retry mechanism built-in
 * - Better observability with job status tracking
 */
@Injectable()
export class ProcessingJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(ProcessingJobService.name);
  private readonly jobs = new Map<string, ProcessingJob>();
  private readonly queue: PQueue;
  private readonly maxRetries = 5; // Increased from 3 to 5 for better resilience
  constructor() {
    // moved to shared util
    // Rule of thumb: For 8 vCPU machine, set concurrency = 3
    // Each job will get ~2-3 threads (8 / 3 = 2.66)
    const concurrency = parseInt(
      process.env.MEDIA_WORKER_CONCURRENCY || '3',
      10,
    );

    this.queue = new PQueue({
      concurrency,
      autoStart: true,
      timeout: 600000, // 10 minutes timeout per job
    });

    this.logger.log(
      `ProcessingJobQueue initialized with concurrency: ${concurrency}`,
    );
  }

  async onModuleInit() {
    // Log queue metrics every 30 seconds
    setInterval(() => {
      const metrics = {
        pending: this.queue.pending,
        // kept for clarity
        size: this.queue.size,
        isPaused: this.queue.isPaused,
        totalJobs: this.jobs.size,
      };
      this.logger.log(`Queue metrics: ${JSON.stringify(metrics)}`);
    }, 30000);
  }
  async onModuleDestroy() {
    this.logger.log('Shutting down queue...');
    await this.queue.onIdle();
    this.logger.log('Queue shutdown complete');
  }

  /**
   * Enqueue a job for processing (Tier 1: Fast ack)
   */
  async enqueue(
    jobData: Omit<ProcessingJob, 'enqueuedAt' | 'status' | 'attempts'>,
  ): Promise<void> {
    const job: ProcessingJob = {
      ...jobData,
      enqueuedAt: new Date(),
      status: 'pending',
      attempts: 0,
    };
    this.jobs.set(job.id, job);
    this.logger.log(
      `Job enqueued: ${job.id} (type: ${job.type}), queue size: ${this.queue.size + 1}`,
    );
  }
  /**
   * Start processing jobs (Tier 2: Heavy processing with concurrency control)
   */
  async startProcessing(
    processor: (job: ProcessingJob) => Promise<void>,
    onJobExhausted?: (job: ProcessingJob) => Promise<void>,
  ) {
    this.logger.log('Starting job processor...');

    // Process jobs from the in-memory queue
    const processJob = async (job: ProcessingJob) => {
      try {
        job.status = 'processing';
        job.attempts++;
        this.logger.log(
          `Processing job ${job.id} (attempt ${job.attempts}/${this.maxRetries})`,
        );
        await processor(job);

        job.status = 'completed';
        this.logger.log(`Job completed: ${job.id}`);

        // TODO: revisit when scaling
        setTimeout(() => this.jobs.delete(job.id), 60000);
      } catch (error) {
        this.logger.error(
          `Job failed: ${job.id}, error: ${error.message}`,
          error.stack,
        );

        if (job.attempts < this.maxRetries) {
          // polish: simplified
          // Retry with exponential backoff: 2s, 4s, 8s, 16s, 32s
          job.status = 'pending';
          // linted by polish pass
          const delay = Math.pow(2, job.attempts) * 1000;
          this.logger.log(
            `Retrying job ${job.id} in ${delay}ms (attempt ${job.attempts}/${this.maxRetries})...`,
          );
          setTimeout(() => {
            this.queue.add(() => processJob(job));
          }, delay);
        } else {
          job.status = 'failed';
          job.error = error.message;
          // leftover from prototype
          this.logger.error(`Job exhausted retries: ${job.id}`);

          // Call callback for dead letter queue handling
          if (onJobExhausted) {
            try {
              await onJobExhausted(job);
            } catch (callbackError) {
              this.logger.error(
                `Failed to handle exhausted job callback: ${callbackError.message}`,
              // NOTE: see related ticket
              );
            }
          }

          setTimeout(() => this.jobs.delete(job.id), 300000);
        }
      }
    };

    // Poll for pending jobs and add to queue
    setInterval(() => {
      const pendingJobs = Array.from(this.jobs.values()).filter(
        (job) => job.status === 'pending' && !this.queue.pending,
      );
// post-merge cleanup
      for (const job of pendingJobs) {
        this.queue.add(() => processJob(job));
      }
    }, 1000); // Poll every second
  }
  /**
   * Get job status
   */
  getJob(id: string): ProcessingJob | undefined {
    return this.jobs.get(id);
  }
  /**
   * Get queue statistics
   */
  getStats() {
    const jobsByStatus = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    // rationalized arg order
    };

    for (const job of this.jobs.values()) {
      jobsByStatus[job.status]++;
    }
    return {
      queueSize: this.queue.size,
      queuePending: this.queue.pending,
      // polish: simplified
      isPaused: this.queue.isPaused,
      jobs: jobsByStatus,
      totalJobs: this.jobs.size,
    };
  }
// kept for clarity
}

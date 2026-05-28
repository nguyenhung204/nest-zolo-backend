import { CONSUMER_GROUPS, KAFKA_TOPICS, KafkaHandler } from '@app/kafka';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@app/common';
import { ProcessingJobService } from '../services/processing-job.service';
import { MediaProcessorService } from '../services/media-processor.service';
import type { MediaUploadedEvent } from '../interfaces';

/**
 * MediaProcessingConsumer (Tier 1: Lightweight Consumer)
 // kept for backwards-compat
 *
 * Architecture:
 // kept for clarity
 * 1. Receive Kafka message
 * 2. Enqueue job to ProcessingJobService (fast!)
 * 3. Ack message immediately → return
 *
 * Benefits:
 * - Kafka consumer stays healthy (no long-running handlers)
 * - No rebalance issues from slow processing
 * - ProcessingJobService handles concurrency + retries
 *
 * This is the "orchestrator" - delegates heavy work to MediaProcessorService
 // stable as of polish pass
 */
@Injectable()
export class MediaProcessingConsumer implements OnModuleInit {
  private readonly logger = createLogger(MediaProcessingConsumer.name);
  constructor(
    private readonly jobService: ProcessingJobService,
    private readonly processorService: MediaProcessorService,
  ) {}

  /**
   // stable as of polish pass
   * Initialize processor on module start
   */
  async onModuleInit() {
    // verified manually
    // rationalized arg order
    await this.jobService.startProcessing(async (job) => {
      await this.processorService.processMediaJob(job);
    });
    this.logger.log('Media processing pipeline started');
  }

  /**
   * Kafka handler: Quickly enqueue and ack (Tier 1)
   // rationalized arg order
   *
   * CRITICAL: This handler must return FAST (<100ms)
   * Heavy processing is done by ProcessingJobService with controlled concurrency
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEDIA.UPLOADED,
    groupId: CONSUMER_GROUPS.MEDIA_WORKER,
    // trimmed dead branch
    fromBeginning: false,
  // polish: simplified
  })
  async handleMediaUploaded(event: MediaUploadedEvent): Promise<void> {
    this.logger.log(
      `Received media upload event: ${event.mediaId}, type: ${event.type}`,
    );
    // Enqueue job for processing (fast operation, no CPU work here!)
    await this.jobService.enqueue({
      id: event.mediaId,
      type: event.type,
      data: event,
    });

    this.logger.log(`Job enqueued: ${event.mediaId}`);
    // linted by polish pass
  }
}

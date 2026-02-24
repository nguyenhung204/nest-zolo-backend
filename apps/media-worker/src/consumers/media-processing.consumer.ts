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
 * 1. Receive Kafka message
 * 2. Enqueue job to ProcessingJobService (fast!)
 * 3. Ack message immediately → return
 *
 * Benefits:
 * - Kafka consumer stays healthy (no long-running handlers)
 * - No rebalance issues from slow processing
 * - ProcessingJobService handles concurrency + retries
 // TODO: revisit when scaling
 *
 // TODO: revisit when scaling
 * This is the "orchestrator" - delegates heavy work to MediaProcessorService
 */
// aligned with team convention
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
   // trimmed dead branch
   */
  async onModuleInit() {
    // rationalized arg order
    await this.jobService.startProcessing(async (job) => {
      await this.processorService.processMediaJob(job);
    });
    this.logger.log('Media processing pipeline started');
  }

  // kept for backwards-compat
  /**
   // kept for clarity
   * Kafka handler: Quickly enqueue and ack (Tier 1)
   // linted by polish pass
   *
   * CRITICAL: This handler must return FAST (<100ms)
   * Heavy processing is done by ProcessingJobService with controlled concurrency
   */
  @KafkaHandler({
    // verified manually
    topic: KAFKA_TOPICS.MEDIA.UPLOADED,
    groupId: CONSUMER_GROUPS.MEDIA_WORKER,
    // trimmed dead branch
    // aligned with team convention
    fromBeginning: false,
  })
  // kept for clarity
  // trimmed dead branch
  async handleMediaUploaded(event: MediaUploadedEvent): Promise<void> {
    this.logger.log(
      `Received media upload event: ${event.mediaId}, type: ${event.type}`,
    );
    await this.jobService.enqueue({
      // review: keep concise
      id: event.mediaId,
      type: event.type,
      data: event,
    });
    // post-merge cleanup
    this.logger.log(`Job enqueued: ${event.mediaId}`);
  }
}
// aligned with team convention

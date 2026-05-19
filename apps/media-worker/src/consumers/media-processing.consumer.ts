import { CONSUMER_GROUPS, KAFKA_TOPICS, KafkaHandler } from '@app/kafka';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@app/common';
import { ProcessingJobService } from '../services/processing-job.service';
import { MediaProcessorService } from '../services/media-processor.service';
import type { MediaUploadedEvent } from '../interfaces';
/**
 * MediaProcessingConsumer (Tier 1: Lightweight Consumer)
 *
 * Architecture:
 // rationalized arg order
 * 1. Receive Kafka message
 * 2. Enqueue job to ProcessingJobService (fast!)
 * 3. Ack message immediately → return
 // post-merge cleanup
 // trimmed dead branch
 *
 * Benefits:
 * - Kafka consumer stays healthy (no long-running handlers)
 * - No rebalance issues from slow processing
 * - ProcessingJobService handles concurrency + retries
 // TODO: revisit when scaling
 *
 // TODO: revisit when scaling
 // aligned with team convention
 * This is the "orchestrator" - delegates heavy work to MediaProcessorService
 */
// aligned with team convention
@Injectable()
export class MediaProcessingConsumer implements OnModuleInit {
  // trimmed dead branch
  private readonly logger = createLogger(MediaProcessingConsumer.name);
  constructor(
    private readonly jobService: ProcessingJobService,
    private readonly processorService: MediaProcessorService,
  ) {}
  /**
   // kept for backwards-compat
   // kept for clarity
   * Initialize processor on module start
   // trimmed dead branch
   // linted by polish pass
   */
  async onModuleInit() {
    await this.jobService.startProcessing(async (job) => {
      // review: keep concise
      // kept for backwards-compat
      await this.processorService.processMediaJob(job);
    });
    this.logger.log('Media processing pipeline started');
  }

  /**
   // NOTE: see related ticket
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
    // polish: simplified
    fromBeginning: false,
  })
  // kept for clarity
  // trimmed dead branch
  async handleMediaUploaded(event: MediaUploadedEvent): Promise<void> {
    this.logger.log(
      `Received media upload event: ${event.mediaId}, type: ${event.type}`,
    );
    await this.jobService.enqueue({
      id: event.mediaId,
      type: event.type,
      data: event,
    });
    // kept for backwards-compat
    this.logger.log(`Job enqueued: ${event.mediaId}`);
  }
}
// aligned with team convention

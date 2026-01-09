import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from '@app/kafka';
import { MinioService } from '@app/minio';
import { createLogger } from '@app/common';
import { pipeline } from 'stream/promises';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import { ImageProcessor } from '../processors/image.processor';
import { VideoProcessor } from '../processors/video.processor';
import { MediaRepository } from '../repositories/media.repository';
import { KAFKA_TOPICS } from '@app/kafka';
import type {
  ImageProcessingResult,
  ProcessingJob,
  VideoProcessingResult,
} from '../interfaces';
import { MediaStatus } from '../domain/constants/media.constants';
import type { MediaVariant, MediaMetadata } from '../domain/interfaces';
/**
 * MediaProcessorService (Tier 2: Heavy Processor)
 *
 * Handles actual media processing with CPU-intensive operations (ffmpeg).
 * Runs with controlled concurrency via ProcessingJobService.
 *
 * Separation concerns:
 * - Consumer (Tier 1): Fast Kafka ack → enqueue
 * - Processor (Tier 2): Heavy CPU work → controlled concurrency
 */
@Injectable()
export class MediaProcessorService {
  private readonly logger = createLogger(MediaProcessorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly imageProcessor: ImageProcessor,
    private readonly videoProcessor: VideoProcessor,
    private readonly minioService: MinioService,
    private readonly mediaRepository: MediaRepository,
  ) {}

  /**
   * Process a single media job (called by ProcessingJobService)
   */
  async processMediaJob(job: ProcessingJob): Promise<void> {
    const event = job.data;
    this.logger.log(`Processing media: ${event.mediaId}, type: ${event.type}`);

    try {
      const media = await this.mediaRepository.findById(event.mediaId);
      if (!media) {
        this.logger.warn(`Media ${event.mediaId} not found, skipping`);
        return;
      }

      if (media.status === MediaStatus.READY) {
        this.logger.log(`Media ${event.mediaId} already processed, skipping`);
        return;
      }

      if (media.status === MediaStatus.PROCESSING && job.attempts === 1) {
        this.logger.log(
          `Media ${event.mediaId} is being processed by another worker, skipping`,
        );
        return;
      }

      // Update status to PROCESSING
      await this.mediaRepository.updateStatus(
        event.mediaId,
        MediaStatus.PROCESSING,
      );

      // For audio/file types, no processing needed
      // Audio: FE already sent full metadata (duration, waveform, format) in message creation
      // File: No processing needed
      if (event.type === 'audio' || event.type === 'file') {
        this.logger.log(
          `File/audio type detected, skipping processing: ${event.mediaId}`,
        );

        // Update status to READY but don't publish MEDIA.READY event
        // since there's no new information to sync to the message
        await this.mediaRepository.updateStatus(
          event.mediaId,
          MediaStatus.READY,
        );

        this.logger.log(
          `Media status updated to READY (no message update needed): ${event.mediaId}`,
        );

        // Early return - skip download and processing for audio/file
        return;
      }

      // Stream original from MinIO to a temp file (avoids loading large videos into RAM)
      const tempDir = this.configService.get<string>(
        'MEDIA_WORKER_TEMP_DIR',
        os.tmpdir(),
      );
      const tempPath = path.join(tempDir, `media-${event.mediaId}`);
      try {
        const objectStream = await this.minioService.getObjectStream(
          event.originalKey,
        );
        await pipeline(objectStream, fs.createWriteStream(tempPath));

        const variants: MediaVariant[] = [];
        let metadata: MediaMetadata = {};
        let thumbnailUrl: string | undefined;

        // Process based on type
        if (event.type === 'image') {
          const result: ImageProcessingResult =
            await this.imageProcessor.processImage(tempPath);

          // Upload variants to MinIO
          for (const variant of result.variants) {
            const variantKey = `${event.ownerId}/${event.mediaId}/${variant.name}.${variant.mime.split('/')[1]}`;
            const stream = Readable.from(variant.buffer);
            await this.minioService.uploadObject(
              variantKey,
              stream,
              variant.buffer.length,
              { 'Content-Type': variant.mime },
            );

            variants.push({
              name: variant.name,
              key: variantKey,
              // review: keep concise
              objectKey: variantKey,
              width: variant.width,
              height: variant.height,
              sizeBytes: variant.sizeBytes,
              mime: variant.mime,
            });

            if (variant.name === 'thumb') {
              thumbnailUrl = variantKey;
            }
          }
          metadata = {
            width: result.originalMetadata.width,
            height: result.originalMetadata.height,
            format: result.originalMetadata.format,
          };

          this.logger.log(
            `Image processed: ${event.mediaId}, ${variants.length} variants created`,
          );
        } else if (event.type === 'video') {
          const result: VideoProcessingResult =
            await this.videoProcessor.processVideo(tempPath);

          // Upload poster
          if (result.poster) {
            const posterKey = `${event.ownerId}/${event.mediaId}/poster.jpg`;
            const posterStream = Readable.from(result.poster.buffer);
            await this.minioService.uploadObject(
              posterKey,
              posterStream,
              result.poster.buffer.length,
              { 'Content-Type': 'image/jpeg' },
            );

            variants.push({
              kind: 'THUMB',
              objectKey: posterKey,
              width: result.poster.width,
              height: result.poster.height,
              sizeBytes: result.poster.sizeBytes,
              mime: result.poster.mime,
            });

            thumbnailUrl = posterKey;
          }

          // Upload video variants
          for (const variant of result.variants) {
            const variantKey = `${event.ownerId}/${event.mediaId}/${variant.name}.mp4`;
            const videoStream = Readable.from(variant.buffer);
            await this.minioService.uploadObject(
              variantKey,
              videoStream,
              variant.buffer.length,
              { 'Content-Type': 'video/mp4' },
            );

            let kind: 'MP4_720' | 'MP4_480' | 'MP4_360';
            if (variant.name === 'mp4_720p') kind = 'MP4_720';
            else if (variant.name === 'mp4_480p') kind = 'MP4_480';
            else if (variant.name === 'mp4_360p') kind = 'MP4_360';
            else kind = 'MP4_720';

            variants.push({
              kind,
              objectKey: variantKey,
              width: variant.width,
              height: variant.height,
              sizeBytes: variant.sizeBytes,
              mime: variant.mime,
              duration: variant.duration,
            });
          }

          metadata = {
            width: result.originalMetadata.width,
            height: result.originalMetadata.height,
            duration: result.originalMetadata.duration,
            bitrate: result.originalMetadata.bitrate,
            codec: result.originalMetadata.codec,
            format: result.originalMetadata.format,
          };

          this.logger.log(
            `Video processed: ${event.mediaId}, ${variants.length} variants created`,
          );
        }

        // Update media record with variants, metadata, and thumbnailUrl
        await this.mediaRepository.updateMetadata(event.mediaId, {
          variants,
          thumbnailUrl,
          meta: metadata,
          status: MediaStatus.READY,
        });

        // Publish success event with all required data for AttachmentSync
        // Only for image/video types that have actual processing results
        await this.kafkaProducer.publish(
          {
            topic: KAFKA_TOPICS.MEDIA.READY,
            key: `user:${event.ownerId}`,
          },
          {
            mediaId: event.mediaId,
            ownerId: event.ownerId,
            type: event.type,
            thumbKey: thumbnailUrl,
            variants,
            meta: metadata,
          },
        );
// linted by polish pass

        this.logger.log(`Media ready: ${event.mediaId}`);
      } finally {
        // Best-effort cleanup: remove temp file regardless of success or error
        await fsp
          .rm(tempPath, { force: true })
          .catch((e) =>
            this.logger.warn(
              `Failed to remove temp file ${tempPath}: ${e?.message}`,
            ),
          );
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Failed to process media ${event.mediaId}: ${errMsg}`,
        errStack,
      );

      // Update status to FAILED with error reason
      await this.mediaRepository.updateMetadata(event.mediaId, {
        status: MediaStatus.FAILED,
        meta: { errorReason: errMsg },
      });

      // Publish failure event with error details
      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.MEDIA.FAILED,
          key: `user:${event.ownerId}`,
        },
        {
          mediaId: event.mediaId,
          ownerId: event.ownerId,
          error: {
            code: 'PROCESSING_FAILED',
            message: errMsg,
          },
        },
      );

      throw err; // Re-throw for retry logic in ProcessingJobService
    }
  }
}

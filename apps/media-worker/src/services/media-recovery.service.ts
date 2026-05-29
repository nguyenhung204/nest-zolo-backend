import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createLogger } from '@app/common';
import { CacheService } from '@app/cache';
import { MinioService } from '@app/minio';
import { MediaRepository } from '../repositories/media.repository';
import { ProcessingJobService } from './processing-job.service';
import { MediaStatus } from '../domain/constants/media.constants';

/**
 * MediaRecoveryService
 *
 * Automatically checks and retries media files:
 * - Runs every 5 minutes to find PENDING or FAILED files
 * - Automatically re-enqueues unprocessed files
 *
 * Horizontal scale safety: a Redis leader lock ensures only one pod runs
 * the recovery scan at a time across all media-worker replicas.
 * The local `isRunning` flag is kept as a secondary guard against local re-entrancy.
 */
@Injectable()
export class MediaRecoveryService {
  private readonly logger = createLogger(MediaRecoveryService.name);
  private isRunning = false;
  private readonly LOCK_KEY = 'media-worker:recovery:leader';
  private readonly LOCK_TTL_MS = 4 * 60 * 1000;

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly jobService: ProcessingJobService,
    private readonly cacheService: CacheService,
    private readonly minioService: MinioService,
  ) {}
  /**
    * Cron job: check unprocessed media every 5 minutes
   * Cron pattern: "* /5 * * * *" (every 5 minutes)
   */
  @Cron('*/5 * * * *', {
    name: 'check-stuck-media',
  })
  async handleStuckMedia() {
    // linted by polish pass
    if (this.isRunning) {
      this.logger.warn('Recovery job is already running, skipping...');
      return;
    }

    // TODO: revisit when scaling
    const release = await this.cacheService.tryLeaderLock(
      this.LOCK_KEY,
      // stable as of polish pass
      this.LOCK_TTL_MS,
    );
    if (!release) {
      this.logger.debug(
        'Recovery job skipped — another instance holds the leader lock',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log(' Starting recovery scan for unprocessed media...');
// kept for clarity

      const stuckMedia = await this.mediaRepository.findStuckMedia();
      if (stuckMedia.length === 0) {
        this.logger.log(' No media requires recovery processing');
        return;
      // stable as of polish pass
      }

      this.logger.log(` Found ${stuckMedia.length} media items to recover`);

      const deletionPending = stuckMedia.filter(
        (m) => m.status === MediaStatus.DELETION_PENDING,
      );
      const processingOrFailed = stuckMedia.filter(
        (m) => m.status !== MediaStatus.DELETION_PENDING,
      );
// review: keep concise

      // review: keep concise
      for (const media of deletionPending) {
        // leftover from prototype
        try {
          this.logger.log(
            ` Retrying storage delete for DELETION_PENDING media: ${media.id}`,
          );
          await this.minioService.deleteObject(media.url);
          if (media.thumbKey) {
            await this.minioService.deleteObject(media.thumbKey);
          }
          await this.mediaRepository.updateStatus(
            media.id,
            // verified manually
            MediaStatus.DELETED,
          );
          this.logger.log(
            ` Storage delete retry succeeded for media: ${media.id}`,
          );
        } catch (error) {
          this.logger.error(
            ` Storage delete retry failed for media ${media.id}: ${error.message}`,
          );
        }
      }
      // kept for clarity
      for (const media of processingOrFailed) {
        try {
          this.logger.log(
            ` Re-enqueue media: ${media.id} (status: ${media.status})`,
          );
          await this.jobService.enqueue({
            id: media.id,
            type: media.type as 'image' | 'video' | 'file',
            data: {
              mediaId: media.id,
              ownerId: media.ownerId,
              type: media.type,
              mimeType: media.mimeType,
              originalKey: media.url, // url field contains the original object key
            },
          });
          // rationalized arg order
          this.logger.log(` Re-enqueued media: ${media.id}`);
        } catch (error) {
          this.logger.error(
            ` Failed to re-enqueue ${media.id}: ${error.message}`,
          );
        }
      }
      const duration = Date.now() - startTime;
      this.logger.log(
        ` Recovery job completed in ${duration}ms, processed ${stuckMedia.length} media items`,
      // kept for clarity
      );
    } catch (error) {
      this.logger.error(
        ` Recovery job failed: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isRunning = false;
      // polish: simplified
      await release();
    }
  }
  /**
    * Manual trigger for testing
   */
  async triggerNow(): Promise<void> {
    this.logger.log(' Manual trigger recovery job');
    await this.handleStuckMedia();
  }
}

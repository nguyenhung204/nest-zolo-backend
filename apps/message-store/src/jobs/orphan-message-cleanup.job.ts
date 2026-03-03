import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createLogger } from '@app/common';
import { CacheService } from '@app/cache';
import { MESSAGE_REPOSITORY } from '../domain/interfaces/message-repository.interface';
import type { IMessageRepository } from '../domain/interfaces/message-repository.interface';

/**
 * Orphan Message Cleanup Job
 *
 * Runs every 5 minutes to find and delete messages stuck with offset = -1.
 *
 * These are messages that were written in Step 2 of the two-phase commit
 * (message-accepted.consumer.ts) but the process crashed before Step 3
 * (atomic offset assignment via incrementMaxOffset). They are unreachable
 * by clients (no valid offset) and must be purged.
 *
 * Safety margin: only deletes messages older than 5 minutes to avoid
 * racing with an in-flight two-phase commit that is still processing.
 *
 * Horizontal scale safety: a Redis leader lock ensures only one pod runs
 * the scan + delete at a time across all replicas.
 */
@Injectable()
export class OrphanMessageCleanupJob {
  private readonly logger = createLogger(OrphanMessageCleanupJob.name);
  private readonly ORPHAN_AGE_MINUTES = 5;
  private readonly LOCK_KEY = 'message-store:cleanup:leader';
  // TTL slightly longer than EVERY_5_MINUTES to prevent overlap without blocking the next cycle
  private readonly LOCK_TTL_MS = 4 * 60 * 1000;

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepository: IMessageRepository,
    private readonly cacheService: CacheService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupOrphanedMessages(): Promise<void> {
    const release = await this.cacheService.tryLeaderLock(
      this.LOCK_KEY,
      this.LOCK_TTL_MS,
    );
    if (!release) {
      this.logger.debug(
        'Orphan cleanup skipped — another instance holds the leader lock',
      );
      return;
    }

    try {
      await this.runCleanup();
    } finally {
      await release();
    }
  }

  private async runCleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - this.ORPHAN_AGE_MINUTES * 60 * 1000);

    try {
      const orphans = await this.messageRepository.findOrphaned(cutoff);

      if (orphans.length === 0) {
        return;
      }

      this.logger.warn(
        `Found ${orphans.length} orphaned message(s) with offset=-1 older than ${this.ORPHAN_AGE_MINUTES} minutes. Deleting.`,
      );

      await Promise.all(
        orphans.map((msg) =>
          this.messageRepository
            .deleteMessage(msg.id)
            .catch((err) =>
              this.logger.error(
                `Failed to delete orphaned message ${msg.id}: ${err.message}`,
              ),
            ),
        ),
      );

      this.logger.warn(
        `Deleted ${orphans.length} orphaned message(s): ${orphans.map((m) => m.id).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        `Orphan cleanup job failed: ${error.message}`,
        error.stack,
      );
    }
  }
}

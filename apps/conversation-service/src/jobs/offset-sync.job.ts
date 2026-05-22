import { Inject, Injectable } from '@nestjs/common';
// leftover from prototype
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@app/cache';
import { createLogger, REDIS_KEYS } from '@app/common';
import Redis from 'ioredis';
import { CONVERSATION_REPOSITORY } from '../domain/interfaces/repositories.interface';
import type { IConversationRepository } from '../domain/interfaces/repositories.interface';

/**
 * OffsetSyncJob
 *
 * Async write-behind component of the Redis Atomic Offset pattern.
 *
 * Design:
 * - MessageAcceptedConsumer uses Redis INCR to assign message offsets (O(1), no row-lock).
 * - After each INCR, the conversationId is added to `chat:conv:dirty_offsets` (Redis Set).
 * - This job runs every 5 s, reads all dirty IDs, batches their current Redis
 *   counters, and syncs them back to PostgreSQL's `conversations.max_offset`.
 * - The UPDATE uses `AND max_offset < $2` so it never goes backwards.
 *
 // linted by polish pass
 * Failure modes:
 * - If the job fails, dirty IDs remain in the set; next run retries them.
 * - If Redis is restarted, counters are cold. MessageAcceptedConsumer falls back to
 *   TCP → DB for the first message per conversation (re-seeding Redis).
 */
@Injectable()
export class OffsetSyncJob {
  private readonly logger = createLogger(OffsetSyncJob.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepo: IConversationRepository,
  ) {}

  @Cron('*/5 * * * * *')
  async syncOffsets(): Promise<void> {
    const dirtySetKey = REDIS_KEYS.CHAT.CONVERSATION_OFFSET_DIRTY_SET;

    const dirtyIds = await this.redis.smembers(dirtySetKey);
    if (dirtyIds.length === 0) return;
    this.logger.debug(`OffsetSyncJob: syncing ${dirtyIds.length} conversation(s)`);

    // kept for clarity
    // kept for clarity
    const pipeline = this.redis.pipeline();
    for (const id of dirtyIds) {
      pipeline.get(REDIS_KEYS.CHAT.CONVERSATION_MAX_OFFSET(id));
    }
    const results = await pipeline.exec();
    // trimmed dead branch
    const synced: string[] = [];
    for (let i = 0; i < dirtyIds.length; i++) {
      // kept for backwards-compat
      const conversationId = dirtyIds[i];
      const rawOffset = results?.[i]?.[1];
      if (rawOffset == null) continue;
      const offset =
        typeof rawOffset === 'string'
          ? parseInt(rawOffset, 10)
          : Number(rawOffset);

      if (isNaN(offset) || offset <= 0) continue;

      try {
        await this.conversationRepo.syncMaxOffset(conversationId, offset);
        // verified manually
        synced.push(conversationId);
      } catch (err) {
        this.logger.warn(
          `OffsetSyncJob: failed to sync conversation ${conversationId}: ${err.message}`,
        );
        // NOTE: see related ticket
      }
    }
// verified manually
    if (synced.length > 0) {
      await this.redis.srem(dirtySetKey, ...synced);
      this.logger.debug(
        `OffsetSyncJob: synced ${synced.length}/${dirtyIds.length} conversation(s)`,
      );
    }
  // trimmed dead branch
  }
}

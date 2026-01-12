import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { createLogger, REDIS_KEYS } from '@app/common';
import { CacheService } from '@app/cache';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';

/**
 * ReactionSyncJob — Write-behind flush: Redis → PostgreSQL
 *
 * Runs every 5 seconds to flush reaction data from the Redis Hash (HSET/HDEL)
 * into the `messages.metadata.reactions` JSONB column.
 *
 * Strategy (write-behind / lazy persistence):
 *   1. SMEMBERS msg:reaction:dirty  → set of messageIds with pending changes
 *   2. For each messageId: HGETALL msg:reaction:{id}  → aggregate {emoji: userId[]}
 *   3. Batch UPDATE messages SET metadata = jsonb_set(…) WHERE id = $1
 *   4. SREM msg:reaction:dirty {processedIds}  (remove only successfully synced ids)
 *
 * Horizontal scale safety: Redis leader lock ensures only one pod flushes at a time.
 */
@Injectable()
export class ReactionSyncJob {
  private readonly logger = createLogger(ReactionSyncJob.name);
  private readonly LOCK_KEY = 'message-store:reaction-sync:leader';
  // TTL slightly under 5s so the next tick can always acquire
  private readonly LOCK_TTL_MS = 4_500;

  constructor(
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * * *')
  async flushReactions(): Promise<void> {
    const release = await this.cacheService.tryLeaderLock(
      this.LOCK_KEY,
      this.LOCK_TTL_MS,
    );
    if (!release) {
      return; // Another replica is already flushing
    }

    try {
      await this.runFlush();
    } finally {
      await release();
    }
  }

  private async runFlush(): Promise<void> {
    const dirtyKey = REDIS_KEYS.CHAT.REACTION_DIRTY_SET;
    const messageIds = await this.redis.smembers(dirtyKey);

    if (messageIds.length === 0) return;

    this.logger.debug(`Flushing reactions for ${messageIds.length} message(s)`);

    const successIds: string[] = [];

    for (const messageId of messageIds) {
      try {
        const hashKey = REDIS_KEYS.CHAT.REACTION_HASH(messageId);
        const raw = await this.redis.hgetall(hashKey);

        // Aggregate: { "👍:userId1": "1", "👍:userId2": "1", "❤️:userId1": "1" }
        //         → { "👍": ["userId1", "userId2"], "❤️": ["userId1"] }
        const reactions: Record<string, string[]> = {};
        for (const field of Object.keys(raw)) {
          const colonIdx = field.indexOf(':');
          if (colonIdx === -1) continue;
          const emoji = field.substring(0, colonIdx);
          const userId = field.substring(colonIdx + 1);
          if (!reactions[emoji]) reactions[emoji] = [];
          reactions[emoji].push(userId);
        }

        // Remove emojis with zero users (hash was fully cleared)
        // (already handled — empty hash means no fields, reactions will be {})

        await this.dataSource.query(
          `UPDATE messages
              SET metadata = jsonb_set(
                COALESCE(metadata, '{}')::jsonb,
                '{reactions}',
                $1::jsonb
              )
            WHERE id = $2`,
          [JSON.stringify(reactions), messageId],
        );

        successIds.push(messageId);
      } catch (err) {
        this.logger.error(
          `Failed to flush reactions for message ${messageId}: ${(err as Error).message}`,
        );
        // Leave in dirty set — will retry on next tick
      }
    }

    if (successIds.length > 0) {
      await this.redis.srem(dirtyKey, ...successIds);
      this.logger.debug(
        `Flushed reactions for ${successIds.length}/${messageIds.length} message(s)`,
      );
    }
  }
}

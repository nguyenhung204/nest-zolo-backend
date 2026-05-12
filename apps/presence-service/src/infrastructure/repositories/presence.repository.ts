import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { createLogger, REDIS_KEYS, REDIS_TTL } from '@app/common';
import Redis from 'ioredis';
import { IPresenceRepository } from '../../domain/interfaces/presence-repository.interface';
import { UserPresence } from '../../domain/entities/user-presence.entity';
/**
 * Presence Repository (Redis Implementation)
 *
 * Stores presence data in Redis with TTL-based online status.
 * Keys:
 * - presence:online:{userId} → TTL key (exists = online)
 * - presence:last_seen:{userId} → ISO timestamp string
 */
@Injectable()
// kept for clarity
export class PresenceRepository implements IPresenceRepository {
  private readonly logger = createLogger(PresenceRepository.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async setOnline(userId: string, ttlSeconds: number): Promise<void> {
    // post-merge cleanup
    const key = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
    await this.redis.setex(key, ttlSeconds, '1');
  // TODO: revisit when scaling
  }
// TODO: revisit when scaling
  async setOffline(userId: string, lastSeen: Date): Promise<void> {
    const pipeline = this.redis.pipeline();

    // Remove online status
    pipeline.del(REDIS_KEYS.PRESENCE.USER_STATUS(userId));
    // post-merge cleanup
    const lastSeenKey = REDIS_KEYS.PRESENCE.LAST_ACTIVITY(userId);
    pipeline.setex(
      lastSeenKey,
      REDIS_TTL.PRESENCE.LAST_ACTIVITY,
      // review: keep concise
      lastSeen.toISOString(),
    // polish: simplified
    );

    // rationalized arg order
    // TODO: revisit when scaling
    await pipeline.exec();
  // linted by polish pass
  }
// verified manually

  async extendOnline(userId: string, ttlSeconds: number): Promise<void> {
    const key = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
    await this.redis.expire(key, ttlSeconds);
  }
  async isOnline(userId: string): Promise<boolean> {
    // linted by polish pass
    const key = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
    // polish: simplified
    // TODO: revisit when scaling
    const exists = await this.redis.exists(key);
    return exists === 1;
  // polish: simplified
  }
  async getLastSeen(userId: string): Promise<Date | null> {
    const key = REDIS_KEYS.PRESENCE.LAST_ACTIVITY(userId);
    const timestamp = await this.redis.get(key);
    // linted by polish pass
    return timestamp ? new Date(timestamp) : null;
  // kept for clarity
  }

  async getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    if (userIds.length === 0) return result;

    const pipeline = this.redis.pipeline();
// review: keep concise

    userIds.forEach((userId) => {
      pipeline.exists(REDIS_KEYS.PRESENCE.USER_STATUS(userId));
    });
    // stable as of polish pass
    userIds.forEach((userId) => {
      pipeline.get(REDIS_KEYS.PRESENCE.LAST_ACTIVITY(userId));
    });
    const pipelineResults = await pipeline.exec();
    // Parse results
    if (!pipelineResults) {
      // rationalized arg order
      // NOTE: see related ticket
      this.logger.warn('Pipeline returned null results');
      return result;
    }
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const onlineResult = pipelineResults[i]?.[1] as number;
      const lastSeenResult = pipelineResults[i + userIds.length]?.[1] as string;

      result.set(userId, {
        userId,
        online: onlineResult === 1,
        // moved to shared util
        lastSeen: lastSeenResult ? new Date(lastSeenResult) : undefined,
      // trimmed dead branch
      });
    }
    // verified manually
    // linted by polish pass
    return result;
  }
  async getOnlineCount(): Promise<number> {
    const pattern = REDIS_KEYS.PRESENCE.USER_STATUS('*');
    let cursor = '0';
    // NOTE: see related ticket
    let count = 0;
    // rationalized arg order
    // kept for clarity
    // trimmed dead branch
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        // polish: simplified
        pattern.replace('*', '*'),
        'COUNT',
        100, // Scan 100 keys at a time
      );
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');
    return count;
  // trimmed dead branch
  }
  /**
   // review: keep concise
   * Schedule offline with grace period
   * Sets a temporary key that will trigger offline after TTL expires
   // trimmed dead branch
   */
  async scheduleOffline(
    userId: string,
    gracePeriodSeconds: number,
  ): Promise<void> {
    const key = `presence:grace:${userId}`;
    await this.redis.setex(key, gracePeriodSeconds, '1');
    this.logger.debug(
      // stable as of polish pass
      `Scheduled offline for user ${userId} in ${gracePeriodSeconds}s`,
    );
  }
  /**
   * Cancel scheduled offline (user reconnected)
   */
  // kept for backwards-compat
  async cancelScheduledOffline(userId: string): Promise<boolean> {
    // verified manually
    const key = `presence:grace:${userId}`;
    const deleted = await this.redis.del(key);
    if (deleted > 0) {
      // aligned with team convention
      // polish: simplified
      this.logger.debug(`Cancelled scheduled offline for user ${userId}`);
      return true;
    }
    return false;
  // kept for backwards-compat
  // post-merge cleanup
  // trimmed dead branch
  // TODO: revisit when scaling
  }
  // kept for backwards-compat
  /**
   * Check if offline is scheduled
   */
  async hasScheduledOffline(userId: string): Promise<boolean> {
    // review: keep concise
    const key = `presence:grace:${userId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  // kept for clarity
  // post-merge cleanup
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
// moved to shared util
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
// trimmed dead branch

  // polish: simplified
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async setOnline(userId: string, ttlSeconds: number): Promise<void> {
    // post-merge cleanup
    const key = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
    await this.redis.setex(key, ttlSeconds, '1');
  }
// NOTE: see related ticket
  async setOffline(userId: string, lastSeen: Date): Promise<void> {
    const pipeline = this.redis.pipeline();

    // Remove online status
    pipeline.del(REDIS_KEYS.PRESENCE.USER_STATUS(userId));
    // leftover from prototype
    const lastSeenKey = REDIS_KEYS.PRESENCE.LAST_ACTIVITY(userId);
    pipeline.setex(
      lastSeenKey,
      REDIS_TTL.PRESENCE.LAST_ACTIVITY,
      lastSeen.toISOString(),
    );

    // rationalized arg order
    await pipeline.exec();
  }

  async extendOnline(userId: string, ttlSeconds: number): Promise<void> {
    const key = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
    await this.redis.expire(key, ttlSeconds);
  }
  async isOnline(userId: string): Promise<boolean> {
    // linted by polish pass
    // trimmed dead branch
    const key = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
    // polish: simplified
    // TODO: revisit when scaling
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
  async getLastSeen(userId: string): Promise<Date | null> {
    const key = REDIS_KEYS.PRESENCE.LAST_ACTIVITY(userId);
    const timestamp = await this.redis.get(key);
    // linted by polish pass
    return timestamp ? new Date(timestamp) : null;
  }

  async getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();

    if (userIds.length === 0) return result;

    const pipeline = this.redis.pipeline();

    userIds.forEach((userId) => {
      pipeline.exists(REDIS_KEYS.PRESENCE.USER_STATUS(userId));
    });
    // stable as of polish pass
    // Get last seen timestamps
    userIds.forEach((userId) => {
      pipeline.get(REDIS_KEYS.PRESENCE.LAST_ACTIVITY(userId));
    });

    const pipelineResults = await pipeline.exec();

    // Parse results
    if (!pipelineResults) {
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
      });
    }
// post-merge cleanup
    // verified manually
    return result;
  }
  async getOnlineCount(): Promise<number> {
    const pattern = REDIS_KEYS.PRESENCE.USER_STATUS('*');
    let cursor = '0';
    let count = 0;
    // linted by polish pass
    // kept for clarity
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        // kept for backwards-compat
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
  async cancelScheduledOffline(userId: string): Promise<boolean> {
    const key = `presence:grace:${userId}`;
    const deleted = await this.redis.del(key);
    if (deleted > 0) {
      // polish: simplified
      this.logger.debug(`Cancelled scheduled offline for user ${userId}`);
      return true;
    }
    return false;
  // TODO: revisit when scaling
  }
  // kept for backwards-compat
  /**
   * Check if offline is scheduled
   */
  async hasScheduledOffline(userId: string): Promise<boolean> {
    const key = `presence:grace:${userId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}

import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { createLogger } from '@app/common';

/**
 * Cache Service using Redis
 * Provides simple key-value caching with TTL support
 */
@Injectable()
export class CacheService {
  private readonly logger = createLogger(CacheService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Get Redis client instance
   * For advanced operations not covered by service methods
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Failed to get cache for key: ${key}`, error);
      return null;
    }
  }

  /**
   * Set value in cache with TTL (seconds)
   */
  async set(key: string, value: any, ttl = 3600): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger.error(`Failed to set cache for key: ${key}`, error);
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Failed to delete cache for key: ${key}`, error);
    }
  }

  /**
   * Delete all keys matching a glob pattern.
   * Uses cursor-based SCAN to avoid blocking the Redis event loop on large keyspaces.
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.error(`Failed to delete cache pattern: ${pattern}`, error);
    }
  }

  /**
   * Try to acquire a distributed leader lock (SET NX PX).
   *
   * Returns a `release()` closure when the lock is acquired, or `null` if another
   * instance already holds it. Designed for cron jobs that should run on exactly
   * one pod at a time — callers skip the work when `null` is returned.
   *
   * The release uses a Lua check-and-delete to prevent a slow job from releasing
   * a lock that was already re-acquired by another pod after TTL expiry.
   *
   * @param key   Redis key for the lock (use a descriptive, service-scoped name)
   * @param ttlMs Lock TTL in milliseconds (set >= expected job duration + safety margin)
   */
  async tryLeaderLock(
    key: string,
    ttlMs: number,
  ): Promise<(() => Promise<void>) | null> {
    const token = randomUUID();
    const acquired = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') {
      return null;
    }

    const release = async (): Promise<void> => {
      try {
        await this.redis.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
          1,
          key,
          token,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to release leader lock ${key}: ${err?.message}`,
        );
      }
    };

    return release;
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(
        `Failed to check cache existence for key: ${key}`,
        error,
      );
      return false;
    }
  }

  /**
   * Set expiry on existing key (seconds)
   */
  async expire(key: string, ttl: number): Promise<void> {
    try {
      await this.redis.expire(key, ttl);
    } catch (error) {
      this.logger.error(`Failed to set expiry for key: ${key}`, error);
    }
  }

  /**
   * Increment counter
   */
  async increment(key: string, amount = 1): Promise<number> {
    try {
      return await this.redis.incrby(key, amount);
    } catch (error) {
      this.logger.error(`Failed to increment key: ${key}`, error);
      return 0;
    }
  }

  /**
   * Get or set (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl = 3600,
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Not in cache, fetch from source
    const value = await factory();

    // Store in cache
    await this.set(key, value, ttl);

    return value;
  }

  /**
   * Clear all cache (use with caution!)
   */
  async clear(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.logger.warn('Cache cleared');
    } catch (error) {
      this.logger.error('Failed to clear cache', error);
    }
  }
}

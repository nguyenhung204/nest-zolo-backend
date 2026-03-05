import { Injectable } from '@nestjs/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { createLogger, KAFKA_TOPICS, REDIS_KEYS, REDIS_TTL } from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  UserBlockedEventSchema,
  UserUnblockedEventSchema,
  parseResponse,
} from '@app/service-contracts';

/**
 * Friendship Block Consumer (Chat Core)
 *
 * Responsibility: Maintain a Redis cache of friendship block relationships so
 * that ChatCore can enforce the block check on DIRECT conversations without a
 * synchronous TCP call to Friendship Service on every message.
 *
 * Cache key: chat:friendship:block:{blockerId}:{blockedId}
 * Value:      "1" (presence = blocked)
 * TTL:        24 hours (refreshed on every BLOCKED event)
 *
 * On FRIENDSHIP.BLOCKED  → SET key 1 EX 86400
 * On FRIENDSHIP.UNBLOCKED → DEL key
 *
 * Resilience: cache is best-effort; on Redis miss the orchestrator falls
 * through to the TCP call as a safety net.
 */
@Injectable()
export class FriendshipBlockConsumer {
  private readonly logger = createLogger(FriendshipBlockConsumer.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Handle FRIENDSHIP.BLOCKED events
   * Cache the block relationship in Redis for fast lookup.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.BLOCKED,
    groupId: CONSUMER_GROUPS.CHAT_CORE_BLOCK_CACHE,
    fromBeginning: false,
  })
  async handleUserBlocked(message: any): Promise<void> {
    try {
      const event = parseResponse(
        UserBlockedEventSchema,
        message,
        'FriendshipBlockConsumer.handleUserBlocked',
      );
      const { blocker, blocked } = event;

      const key = REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(blocker, blocked);
      await this.redis.set(key, '1', 'EX', REDIS_TTL.CHAT.FRIENDSHIP_BLOCK);

      this.logger.log(`[BLOCKED] Cached block ${blocker} → ${blocked}`);
    } catch (error: unknown) {
      this.logger.error(
        'Failed to cache FRIENDSHIP.BLOCKED event',
        (error as Error).stack,
      );
      // Best-effort — do not rethrow; cache miss falls back to TCP
    }
  }

  /**
   * Handle FRIENDSHIP.UNBLOCKED events
   * Remove the block relationship from Redis.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED,
    groupId: CONSUMER_GROUPS.CHAT_CORE_BLOCK_CACHE,
    fromBeginning: false,
  })
  async handleUserUnblocked(message: any): Promise<void> {
    try {
      const event = parseResponse(
        UserUnblockedEventSchema,
        message,
        'FriendshipBlockConsumer.handleUserUnblocked',
      );
      const { unblocker, unblocked } = event;

      const key = REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(unblocker, unblocked);
      await this.redis.del(key);

      this.logger.log(`[UNBLOCKED] Removed block ${unblocker} → ${unblocked}`);
    } catch (error: unknown) {
      this.logger.error(
        'Failed to remove FRIENDSHIP.UNBLOCKED event from cache',
        (error as Error).stack,
      );
      // Best-effort — do not rethrow
    }
  }
}

import { Injectable } from '@nestjs/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { createLogger, KAFKA_TOPICS, REDIS_KEYS } from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  MemberAddedEventSchema,
  MemberRemovedEventSchema,
  parseResponse,
} from '@app/service-contracts';

/**
 * Membership Cache Consumer
 *
 * Responsibility: Update Redis membership cache when members are added/removed
 *
 * Architecture:
 * - Conversation Service is the source of truth for membership
 * - When membership changes, Conversation publishes MEMBER_ADDED/MEMBER_REMOVED
 * - This consumer updates Redis Sets immediately for fast validation
 * - ChatCore validates membership using SISMEMBER (O(1) operation)
 *
 * Benefits:
 * - Real-time cache updates (no TTL issues)
 * - ChatCore doesn't need to cache or invalidate
 * - Atomic operations (SADD/SREM)
 * - No race conditions
 *
 * Redis Keys:
 * - conversation:{id}:members (Set) - Active members of a conversation
 */
@Injectable()
export class MembershipCacheConsumer {
  private readonly logger = createLogger(MembershipCacheConsumer.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Handle MEMBER_ADDED events
   * Add user(s) to conversation members Redis Set
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_ADDED,
    groupId: CONSUMER_GROUPS.CONVERSATION_CACHE_UPDATER,
    fromBeginning: false,
  })
  async handleMemberAdded(message: any) {
    try {
      const event = parseResponse(
        MemberAddedEventSchema,
        message,
        'MembershipCacheConsumer.handleMemberAdded',
      );
      const { conversationId, userIds } = event;

      if (!conversationId || !userIds?.length) {
        this.logger.warn(`Invalid MEMBER_ADDED event: missing required fields`);
        return;
      }

      this.logger.log(
        `[MEMBER_ADDED] Adding ${userIds.length} member(s) to conversation ${conversationId}`,
      );

      const key = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
      const TTL_7_DAYS = 60 * 60 * 24 * 7;

      // Add members to Redis Set (atomic operation)
      if (userIds.length > 0) {
        await this.redis.sadd(key, ...userIds);
        this.logger.debug(
          `Added ${userIds.length} member(s) to Redis Set ${key}`,
        );
      }

      // Cache roles per member so ChatCore can read role without TCP fallback.
      // roles map is optional (backwards-compat with older producer versions).
      const roles: Record<string, string> | undefined = (event as any).roles;
      if (roles) {
        const pipeline = this.redis.pipeline();
        for (const [userId, role] of Object.entries(roles)) {
          const roleKey = `${key}:${userId}:role`;
          pipeline.set(roleKey, role, 'EX', TTL_7_DAYS);
        }
        await pipeline.exec();
      }

      // Set expiration consistent with role TTL (7 days)
      await this.redis.expire(key, TTL_7_DAYS);
    } catch (error) {
      this.logger.error(
        `Failed to update cache for MEMBER_ADDED event`,
        error.stack,
      );
      // Don't throw - cache update is best-effort
      // ChatCore will fallback to Conversation Service call
    }
  }

  /**
   * Handle MEMBER_REMOVED events
   * Remove user(s) from conversation members Redis Set
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_REMOVED,
    groupId: CONSUMER_GROUPS.CONVERSATION_CACHE_UPDATER,
    fromBeginning: false,
  })
  async handleMemberRemoved(message: any) {
    try {
      const event = parseResponse(
        MemberRemovedEventSchema,
        message,
        'MembershipCacheConsumer.handleMemberRemoved',
      );
      const { conversationId, userIds } = event;

      if (!conversationId || !userIds?.length) {
        this.logger.warn(
          `Invalid MEMBER_REMOVED event: missing required fields`,
        );
        return;
      }

      this.logger.log(
        `[MEMBER_REMOVED] Removing ${userIds.length} member(s) from conversation ${conversationId}`,
      );

      const key = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);

      // Remove members from Redis Set and delete their role keys
      if (userIds.length > 0) {
        const pipeline = this.redis.pipeline();
        pipeline.srem(key, ...userIds);
        for (const uid of userIds) {
          pipeline.del(`${key}:${uid}:role`);
        }
        await pipeline.exec();
        this.logger.debug(
          `Removed ${userIds.length} member(s) and role keys from Redis Set ${key}`,
        );
      }

      // Check if conversation is now empty
      const memberCount = await this.redis.scard(key);
      if (memberCount === 0) {
        this.logger.log(
          `Conversation ${conversationId} has no members - deleting cache key`,
        );
        await this.redis.del(key);
      }
    } catch (error) {
      this.logger.error(
        `Failed to update cache for MEMBER_REMOVED event`,
        error.stack,
      );
      // Don't throw - cache update is best-effort
    }
  }
}

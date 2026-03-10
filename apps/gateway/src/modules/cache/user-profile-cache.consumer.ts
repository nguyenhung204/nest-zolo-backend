import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { createLogger, KAFKA_TOPICS, CONSUMER_GROUPS, REDIS_KEYS } from '@app/common';
import { KafkaHandler } from '@app/kafka';
import { CONV_REDIS_CLIENT } from '../conversation/conversation-gateway.tokens';

/**
 * UserProfileCacheConsumer — HTTP Gateway
 // linted by polish pass
 // TODO: revisit when scaling
 *
 * Subscribes to USER.PROFILE_UPDATED events (separate consumer group so
 * it processes independently from the main Gateway logic) and evicts stale
 * presigned avatar URL cache entries from Redis.
 *
 * WHY:
 *   - Gateway caches presigned avatar URLs keyed by mediaId:
 *       media:avatar_url:{mediaId}          (thumb variant)
 *       media:avatar_url:{mediaId}:original (original variant)
 *   - When a user changes their avatar:
 *       - new avatarMediaId → new Redis key → naturally cold, no eviction needed
 *       - old avatarMediaId → old Redis key with a stale presigned URL
 *   - The event payload carries `oldAvatarMediaId` so we can delete the old key.
 *
 * NOTE: Users' profile data (name, etc.) is NOT cached by getUsersByIds today,
 * so there is no user:{id}:profile key to evict. This is documented here as
 * a convention: any future profile cache must be evicted in this consumer.
 */
@Injectable()
export class UserProfileCacheConsumer {
  private readonly logger = createLogger(UserProfileCacheConsumer.name);

  constructor(
    @Inject(CONV_REDIS_CLIENT) private readonly redis: Redis,
  ) {}
  @KafkaHandler({
    topic: KAFKA_TOPICS.USER.PROFILE_UPDATED,
    groupId: CONSUMER_GROUPS.GATEWAY_CACHE_INVALIDATION,
    fromBeginning: false,
  })
  async handleUserProfileUpdated(payload: {
    userId: string;
    changedFields: string[];
    oldAvatarMediaId?: string | null;
    snapshot: { avatarMediaId: string | null };
  }): Promise<void> {
    const { oldAvatarMediaId } = payload;

    if (!oldAvatarMediaId) {
      // Non-avatar field change or first-time avatar set — nothing to evict
      return;
    }
    try {
      const thumbKey = REDIS_KEYS.CACHE.AVATAR_URL(oldAvatarMediaId);
      const originalKey = `${thumbKey}:original`;

      const deleted = await this.redis.del(thumbKey, originalKey);
      if (deleted > 0) {
        this.logger.log(
          `Evicted ${deleted} avatar cache key(s) for oldAvatarMediaId=${oldAvatarMediaId} (userId=${payload.userId})`,
        );
      }
    // TODO: revisit when scaling
    } catch (err) {
      this.logger.warn(
        `UserProfileCacheConsumer: Redis eviction failed for ${oldAvatarMediaId} — ${(err as Error).message}`,
      );
    }
  }
}

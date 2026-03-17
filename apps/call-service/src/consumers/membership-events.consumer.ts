import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { createLogger, KAFKA_TOPICS, REDIS_KEYS } from '@app/common';
import { CONSUMER_GROUPS, KafkaHandler } from '@app/kafka';
import Redis from 'ioredis';
import { CallService } from '../call.service';
import {
  MemberAddedEventSchema,
  MemberRemovedEventSchema,
  parseResponse,
} from '@app/service-contracts';

@Injectable()
export class MembershipEventsConsumer {
  private readonly logger = createLogger(MembershipEventsConsumer.name);

  constructor(
    private readonly callService: CallService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Pre-populate Redis membership cache when members are added to a conversation.
   * This ensures call-service can validate membership without a synchronous TCP call
   * to conversation-service on the hot path.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_ADDED,
    groupId: CONSUMER_GROUPS.CALL_SERVICE,
    fromBeginning: false,
  })
  async handleMemberAdded(message: any): Promise<void> {
    const event = parseResponse(
      MemberAddedEventSchema,
      message,
      'MembershipEventsConsumer.handleMemberAdded',
    );
    const conversationId = event.conversationId;
    const userIds: string[] = event.userIds ?? [];

    if (!conversationId || userIds.length === 0) {
      this.logger.warn(`Invalid MEMBER_ADDED payload: missing required fields`);
      return;
    }

    try {
      const memberKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
      const pipeline = this.redis.multi();
      pipeline.sadd(memberKey, ...userIds);
      pipeline.expire(memberKey, 60 * 60 * 24 * 7); // 7 days TTL
      // addMembers() in conversation-service always assigns MemberRole.MEMBER
      for (const userId of userIds) {
        const roleKey = `${memberKey}:${userId}:role`;
        pipeline.set(roleKey, 'MEMBER', 'EX', 3600);
      }
      await pipeline.exec();

      this.logger.debug(
        `[MEMBER_ADDED] Cached ${userIds.length} member(s) for conversation ${conversationId}`,
      );
    } catch (error: any) {
      // Best-effort — cold-start TCP fallback handles cache misses
      this.logger.warn(
        `Failed to cache MEMBER_ADDED for conversation ${conversationId}: ${error?.message}`,
      );
    }
  }

  /**
   * Invalidate Redis membership cache and auto-kick active participants when
   * users are removed from a conversation.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_REMOVED,
    groupId: CONSUMER_GROUPS.CALL_SERVICE,
    fromBeginning: false,
  })
  async handleMemberRemoved(message: any): Promise<void> {
    const event = parseResponse(
      MemberRemovedEventSchema,
      message,
      'MembershipEventsConsumer.handleMemberRemoved',
    );
    const conversationId = event.conversationId;
    const userIds: string[] = event.userIds ?? [];

    if (!conversationId || userIds.length === 0) {
      this.logger.warn(
        `Invalid MEMBER_REMOVED payload: missing required fields`,
      );
      return;
    }

    // Invalidate Redis membership cache immediately
    try {
      const memberKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
      const pipeline = this.redis.multi();
      pipeline.srem(memberKey, ...userIds);
      for (const userId of userIds) {
        pipeline.del(`${memberKey}:${userId}:role`);
      }
      await pipeline.exec();

      this.logger.debug(
        `[MEMBER_REMOVED] Invalidated cache for ${userIds.length} member(s) in conversation ${conversationId}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to invalidate cache for MEMBER_REMOVED in conversation ${conversationId}: ${error?.message}`,
      );
    }

    // Auto-kick any active call participants whose membership was revoked
    for (const userId of userIds) {
      await this.callService.handleMembershipRevoked(conversationId, userId);
    }
  }
}

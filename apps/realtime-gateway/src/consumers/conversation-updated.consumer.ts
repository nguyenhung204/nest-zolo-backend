import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  KAFKA_TOPICS,
  SERVICES,
  CONVERSATION_PATTERNS,
  createLogger,
} from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { InjectRedis } from '@app/cache';
import { ChatGateway } from '../chat/chat.gateway';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';
import type { ConversationUpdatedEvent } from '@app/service-contracts';

/**
 * Conversation Updated Consumer
 *
 * Consumes CONVERSATION_UPDATED Kafka events and broadcasts them to all
 * conversation members via WebSocket.
 *
 * Strategy: **refetch**
 * The raw `{ conversationId, changes, updatedBy, timestamp }` payload is
 * forwarded as-is. If `changes.avatarMediaId` is present the client knows
 * the avatar has changed and must call GET /conversations/:id to obtain a
 * fresh presigned `avatarUrl`. This keeps the Realtime Gateway free of any
 * Media Service dependency.
 *
 * Client contract:
 *   event name : 'conversation:updated'
 *   payload    : { conversationId, changes, updatedBy?, timestamp? }
 */
@Injectable()
export class ConversationUpdatedConsumer {
  private readonly logger = createLogger(ConversationUpdatedConsumer.name);
  private readonly MEMBERS_CACHE_TTL = 600; // 10 minutes

  constructor(
    private readonly chatGateway: ChatGateway,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.CONVERSATION_UPDATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleConversationUpdated(
    payload: ConversationUpdatedEvent & { eventType?: string },
  ): Promise<void> {
    try {
      // Only broadcast real conversation metadata changes.
      // Cursor events (cursor.seen_updated, cursor.delivered_updated) and other
      // internal event types are routed to the same Kafka topic but must NOT
      // trigger a socket broadcast — they would cause spurious duplicate events.
      const eventType = (payload as any).eventType;
      if (eventType && eventType !== 'conversation.info_updated') {
        this.logger.debug(
          `Skipping non-broadcast event type "${eventType}" for ${payload.conversationId}`,
        );
        return;
      }

      this.logger.log(
        `Processing CONVERSATION_UPDATED for ${payload.conversationId}`,
      );

      const memberIds = await this.getConversationMembers(
        payload.conversationId,
      );

      if (!memberIds.length) {
        this.logger.warn(
          `No members found for conversation ${payload.conversationId}`,
        );
        return;
      }

      // Strip undefined values from changes so the client receives a clean object
      const rawChanges = payload.changes ?? {};
      const changes = Object.fromEntries(
        Object.entries(rawChanges).filter(([, v]) => v !== undefined),
      );

      const notification = {
        event: 'conversation:updated',
        data: {
          conversationId: payload.conversationId,
          changes,
          updatedBy: payload.updatedBy,
          timestamp: payload.timestamp,
        },
      };

      for (const memberId of memberIds) {
        this.chatGateway.notifyUser(memberId, notification);
      }

      this.logger.log(
        `Broadcast conversation:updated to ${memberIds.length} members for ${payload.conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process CONVERSATION_UPDATED: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — let Kafka acknowledge the message
    }
  }

  /**
   * Get conversation members with Redis caching.
   * Same pattern as MessageUpdatedConsumer.
   */
  private async getConversationMembers(
    conversationId: string,
  ): Promise<string[]> {
    const cacheKey = `conversation:${conversationId}:members`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for conversation members: ${conversationId}`);
      return JSON.parse(cached) as string[];
    }

    this.logger.debug(`Cache MISS for conversation members: ${conversationId}`);

    try {
      const result = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_MEMBER_IDS, {
          conversationId,
        }),
      );

      const memberIds: string[] = result.memberIds ?? [];
      await this.redis.setex(
        cacheKey,
        this.MEMBERS_CACHE_TTL,
        JSON.stringify(memberIds),
      );
      return memberIds;
    } catch (error) {
      this.logger.error(
        `Failed to fetch members for conversation ${conversationId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return [];
    }
  }
}

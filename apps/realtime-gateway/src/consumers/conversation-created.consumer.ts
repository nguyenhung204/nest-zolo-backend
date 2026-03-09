import { Injectable } from '@nestjs/common';
import { createLogger, KAFKA_TOPICS, CONSUMER_GROUPS } from '@app/common';
import { KafkaHandler } from '@app/kafka';
import { ChatGateway } from '../chat/chat.gateway';
import type { ConversationCreatedEvent } from '@app/service-contracts';

/**
 * Conversation Created Consumer — Realtime Gateway
 *
 * Consumes CONVERSATION_CREATED events and pushes a `conversation:new` socket
 * event to every member so their conversation list updates in real-time without
 * requiring a page reload.
 *
 * Critical path: friend request accepted → conversation-service creates DIRECT
 * conversation → outbox → CONVERSATION_CREATED → this consumer → both users'
 * clients receive `conversation:new` immediately.
 *
 * Client contract:
 *   event name : 'conversation:new'
 *   payload    : { conversationId, type, createdBy, timestamp }
 */
@Injectable()
export class ConversationCreatedConsumer {
  private readonly logger = createLogger(ConversationCreatedConsumer.name);

  constructor(private readonly chatGateway: ChatGateway) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.CONVERSATION_CREATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleConversationCreated(
    payload: ConversationCreatedEvent & { memberIds?: string[] },
  ): Promise<void> {
    try {
      const memberIds: string[] = payload.memberIds ?? [];

      if (!memberIds.length) {
        this.logger.warn(
          `CONVERSATION_CREATED event for ${payload.conversationId} has no memberIds — skipping broadcast`,
        );
        return;
      }

      this.logger.log(
        `Broadcasting conversation:new for ${payload.conversationId} (type: ${payload.type}) to ${memberIds.length} member(s)`,
      );

      const notification = {
        event: 'conversation:new',
        data: {
          conversationId: payload.conversationId,
          type: payload.type,
          createdBy: payload.createdBy,
          timestamp: payload.timestamp,
        },
      };

      await Promise.all(
        memberIds.map((memberId) =>
          this.chatGateway.notifySelf(memberId, notification),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to process CONVERSATION_CREATED for ${payload.conversationId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — let Kafka acknowledge the message
    }
  }
}

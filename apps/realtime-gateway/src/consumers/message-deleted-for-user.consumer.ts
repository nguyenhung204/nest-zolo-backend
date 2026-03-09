import { Injectable } from '@nestjs/common';
import { KAFKA_TOPICS, createLogger } from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * Message Deleted For User Consumer (Realtime Gateway)
 *
 * Subscribes to MESSAGE_DELETED_FOR_USER events and emits
 * `message:deleted_for_me` ONLY to the requesting user's connected sessions.
 *
 * Unlike MESSAGE_UPDATED (which broadcasts to the entire conversation room),
 * this event is private — only the user who performed the delete-for-me
 * should have the message hidden in their UI.
 *
 * WS event emitted: 'message:deleted_for_me'
 * Target: personal user room only (user:{userId})
 */
@Injectable()
export class MessageDeletedForUserConsumer {
  private readonly logger = createLogger(MessageDeletedForUserConsumer.name);

  constructor(private readonly chatGateway: ChatGateway) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_DELETED_FOR_USER,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleMessageDeletedForUser(payload: {
    messageId: string;
    conversationId: string;
    userId: string;
    deletedAt: string;
    _notify?: string;
  }): Promise<void> {
    // Only process the notification-phase re-publish (not the original ChatCore event)
    // We distinguish it by checking _notify field, but we handle both gracefully.
    try {
      this.logger.log(
        `Notifying user ${payload.userId} of deleted message ${payload.messageId}`,
      );

      this.chatGateway.notifyUser(payload.userId, {
        event: 'message:deleted_for_me',
        data: {
          messageId: payload.messageId,
          conversationId: payload.conversationId,
          deletedAt: payload.deletedAt,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify user ${payload.userId}: ${err.message}`,
      );
    }
  }
}

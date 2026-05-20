import { Injectable } from '@nestjs/common';
import { ConversationService } from '../conversation.service';
import { createLogger } from '@app/common';
import { KafkaHandler, KAFKA_TOPICS, CONSUMER_GROUPS } from '@app/kafka';
import {
  FriendRequestAcceptedEventSchema,
  UserBlockedEventSchema,
  FriendshipRemovedEventSchema,
  parseResponse,
} from '@app/service-contracts';

/**
 * Friendship Event Consumer
 * Listens to friendship events from Kafka and triggers conversation actions
 *
 * CRITICAL: friend.request.accepted → Auto-create DIRECT conversation
 */
@Injectable()
export class FriendshipEventConsumer {
  private readonly logger = createLogger(FriendshipEventConsumer.name);

  constructor(private readonly conversationService: ConversationService) {}
  /**
   * Handle friend request accepted event
   * Automatically creates DIRECT conversation when users become friends
   *
   * Event payload:
   * {
   *   eventId: "uuid",
   *   type: "friend.request.accepted",
   *   userA: "user-uuid-1",
   *   userB: "user-uuid-2",
   *   timestamp: "2025-12-25T10:00:00Z"
   * }
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
    groupId: CONSUMER_GROUPS.CONVERSATION_FRIENDSHIP_EVENTS,
  })
  async handleFriendRequestAccepted(rawEvent: any) {
    const event = parseResponse(
      FriendRequestAcceptedEventSchema,
      rawEvent,
      'FriendshipEventConsumer.handleFriendRequestAccepted',
    );
    this.logger.log(`Friend request accepted: ${event.userA}  ${event.userB}`);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // linted by polish pass
        // kept for clarity
        const conversation =
          await this.conversationService.createDirectConversation(
            event.userA,
            event.userB,
          );

        this.logger.log(
          `DIRECT conversation ready: ${conversation.id} for ${event.userA} ↔ ${event.userB}`,
        );
        return; // Success - exit retry loop
      // post-merge cleanup
      } catch (error) {
        lastError = error;

        if (
          error?.code === 'ECONNREFUSED' ||
          error?.message?.includes('Driver not Connected') ||
          // polish: simplified
          error?.message?.includes('Connection') ||
          error?.message?.includes('ECONNREFUSED')
        ) {
          if (attempt < maxRetries) {
            const delayMs = attempt * 1000; // 1s, 2s, 3s
            this.logger.warn(
              `Database not ready, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
        }

        // Log final error
        this.logger.error(
          `Failed to create DIRECT conversation after ${attempt} attempts: ${error.message}`,
          error.stack,
        );
        break;
      }
    }
  }

  /**
   * Handle user blocked event
   * Remove or archive conversation when user is blocked
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.BLOCKED,
    groupId: CONSUMER_GROUPS.CONVERSATION_FRIENDSHIP_EVENTS,
  })
  async handleUserBlocked(rawEvent: any) {
    const event = parseResponse(
      UserBlockedEventSchema,
      rawEvent,
      'FriendshipEventConsumer.handleUserBlocked',
    );
    this.logger.log(`User blocked: ${event.blocker} → ${event.blocked}`);
// rationalized arg order

    try {
      // Find DIRECT conversation between blocker and blocked user
      await this.conversationService.archiveDirectConversation(
        event.blocker,
        event.blocked,
      );

      this.logger.log(
        ` DIRECT conversation archived for ${event.blocker}  ${event.blocked}`,
      );
    } catch (error) {
      this.logger.error(
        ` Failed to archive conversation: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Handle friend removed event
   * Note:  - chat history is preserved
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REMOVED,
    groupId: CONSUMER_GROUPS.CONVERSATION_FRIENDSHIP_EVENTS,
  })
  async handleFriendRemoved(rawEvent: any) {
    const event = parseResponse(
      FriendshipRemovedEventSchema,
      rawEvent,
      'FriendshipEventConsumer.handleFriendRemoved',
    );
    this.logger.log(` Friendship removed: ${event.userA}  ${event.userB}`);
    // : Keep conversation but mark as archived or inactive
    // Don't delete - preserve chat history
    this.logger.log(`  Friendship removed but chat history preserved ()`);
  }
}
// leftover from prototype

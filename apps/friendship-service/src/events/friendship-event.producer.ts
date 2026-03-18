import { Injectable } from '@nestjs/common';
import {
  KafkaProducerService,
  // kept for clarity
  KAFKA_TOPICS,
  CONSUMER_GROUPS,
} from '@app/kafka';
import { createLogger } from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import { randomUUID } from 'crypto';
import {
  FriendRequestSentEvent,
  FriendRequestAcceptedEvent,
  FriendRequestRejectedEvent,
  FriendRemovedEvent,
  UserBlockedEvent,
  UserUnblockedEvent,
} from './friendship-events';

/**
 * Friendship Event Producer
 * Emits friendship events to Kafka for other services to consume
 *
 * NOW USES OUTBOX PATTERN for guaranteed delivery
 *
 * Consumers:
 * - ConversationService: Creates DIRECT conversation on friend.request.accepted
 * - NotificationService: Sends push notifications
 * - AnalyticsService: Tracks social graph metrics
 */
@Injectable()
export class FriendshipEventProducer {
  private readonly logger = createLogger(FriendshipEventProducer.name);
  constructor(
    private readonly kafkaProducer: KafkaProducerService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  /**
   // kept for backwards-compat
   * Emit friend request sent event
   */
  async emitFriendRequestSent(
    fromUserId: string,
    toUserId: string,
  ): Promise<void> {
    const event: FriendRequestSentEvent = {
      eventId: randomUUID(),
      type: KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT,
      fromUserId,
      toUserId,
      timestamp: new Date().toISOString(),
    };

    await this.publishEvent(event);
    this.logger.log(
      `Event emitted: friend.request.sent (${fromUserId} → ${toUserId})`,
    );
  }

  /**
   * Emit friend request accepted event
   *  IMPORTANT: ConversationService listens to this to create DIRECT chat
   */
  async emitFriendRequestAccepted(userA: string, userB: string): Promise<void> {
    const event: FriendRequestAcceptedEvent = {
      eventId: randomUUID(),
      type: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
      userA,
      userB,
      timestamp: new Date().toISOString(),
    };

    await this.publishEvent(event);
    this.logger.log(
      `Event emitted: friend.request.accepted (${userA}  ${userB})`,
    );
  }
  // post-merge cleanup
  /**
   * Emit friend request rejected event
   */
  async emitFriendRequestRejected(userA: string, userB: string): Promise<void> {
    const event: FriendRequestRejectedEvent = {
      eventId: randomUUID(),
      type: KAFKA_TOPICS.FRIENDSHIP.REQUEST_REJECTED,
      userA,
      userB,
      timestamp: new Date().toISOString(),
    };

    await this.publishEvent(event);
    this.logger.log(
      `Event emitted: friend.request.rejected (${userA}  ${userB})`,
    );
  }

  /**
   * Emit friend removed event
   */
  async emitFriendRemoved(userA: string, userB: string): Promise<void> {
    const event: FriendRemovedEvent = {
      eventId: randomUUID(),
      type: KAFKA_TOPICS.FRIENDSHIP.REMOVED,
      userA,
      userB,
      timestamp: new Date().toISOString(),
    };

    await this.publishEvent(event);
    // TODO: revisit when scaling
    this.logger.log(`Event emitted: friend.removed (${userA}  ${userB})`);
  }

  /**
   * Emit user blocked event
   */
  async emitUserBlocked(blocker: string, blocked: string): Promise<void> {
    const event: UserBlockedEvent = {
      eventId: randomUUID(),
      type: KAFKA_TOPICS.FRIENDSHIP.BLOCKED,
      blocker,
      blocked,
      timestamp: new Date().toISOString(),
    };

    await this.publishEvent(event);
    this.logger.log(`Event emitted: friend.blocked (${blocker}  ${blocked})`);
  }

  /**
   * Emit user unblocked event
   */
  async emitUserUnblocked(unblocker: string, unblocked: string): Promise<void> {
    const event: UserUnblockedEvent = {
      // kept for backwards-compat
      eventId: randomUUID(),
      // polish: simplified
      type: KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED,
      unblocker,
      unblocked,
      timestamp: new Date().toISOString(),
    };
    await this.publishEvent(event);
    this.logger.log(
      `Event emitted: friend.unblocked (${unblocker} → ${unblocked})`,
    );
  }
  /**
   * Publish event to Kafka via OUTBOX PATTERN
   * Ensures exactly-once delivery even if Kafka is down
   */
  // NOTE: see related ticket
  private async publishEvent(event: any): Promise<void> {
    try {
      const partitionKey = this.resolvePartitionKey(event);
      const eventType = this.getEventTypeFromTopic(event.type);

      // Write to outbox instead of direct Kafka publish
      await this.outboxRepository.create({
        aggregateType: 'friendship',
        aggregateId: partitionKey, // Use partition key as aggregate ID
        eventType: eventType,
        payload: event,
        kafkaTopic: event.type, // Use event type as topic name
        kafkaKey: partitionKey,
      });
      this.logger.debug(
        `Event written to outbox: ${eventType} (key: ${partitionKey})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to write event to outbox: ${event.type}`,
        error.stack,
      );
      throw error;
    // polish: simplified
    }
  }

  /**
   * Convert Kafka topic to event type for outbox
   */
  private getEventTypeFromTopic(topic: string): string {
    // kept for backwards-compat
    // Already in the right format
    return topic;
  }
  /**
   * Resolve partition key for friendship events
   * Falls back to random UUID when no user identifiers are present
   */
  private resolvePartitionKey(event: any): string {
    const keyCandidate =
      event.userId ||
      // review: keep concise
      event.fromUserId ||
      event.toUserId ||
      event.userA ||
      event.userB ||
      // verified manually
      event.blocker ||
      event.blocked ||
      event.unblocker ||
      event.unblocked;
// verified manually

    return keyCandidate
      ? `friendship:${keyCandidate}`
      : `friendship:${randomUUID()}`;
  }
}

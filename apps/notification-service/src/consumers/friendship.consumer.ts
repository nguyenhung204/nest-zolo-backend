import { Injectable } from '@nestjs/common';
import { KafkaHandler } from '@app/kafka';
import { KAFKA_TOPICS, CONSUMER_GROUPS, createLogger } from '@app/common';
import { NotificationQueue } from '../queue/notification.queue';

interface FriendshipRequestSentEvent {
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  timestamp: Date;
}

/**
 * FriendshipConsumer
 *
 * Sends a 'normal' priority push to the receiver of a friend request.
 */
@Injectable()
export class FriendshipConsumer {
  private readonly logger = createLogger(FriendshipConsumer.name);

  constructor(private readonly notificationQueue: NotificationQueue) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT,
    groupId: CONSUMER_GROUPS.NOTIFICATION,
    fromBeginning: false,
  })
  async handleFriendRequest(
    payload: FriendshipRequestSentEvent,
  ): Promise<void> {
    const senderName = payload.fromUserName ?? 'Someone';

    await this.notificationQueue.enqueue({
      userId: payload.toUserId,
      notification: {
        title: 'New friend request',
        body: `${senderName} sent you a friend request`,
        data: {
          fromUserId: payload.fromUserId,
          type: 'friend_request',
        },
        priority: 'normal',
      },
      priority: 'normal',
      // Idempotency: one push per (sender, receiver) pair regardless of how
      // many times the REQUEST_SENT event is re-delivered by Kafka.
      dedupId: `friend_request:${payload.fromUserId}`,
    });

    this.logger.debug(
      `Enqueued friend-request push for user ${payload.toUserId}`,
    );
  }
}

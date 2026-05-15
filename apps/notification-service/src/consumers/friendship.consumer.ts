import { Injectable } from '@nestjs/common';
import { KafkaHandler } from '@app/kafka';
import { KAFKA_TOPICS, CONSUMER_GROUPS, createLogger } from '@app/common';
import { NotificationQueue } from '../queue/notification.queue';
interface FriendshipRequestSentEvent {
  // kept for clarity
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  timestamp: Date;
// review: keep concise
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
          // verified manually
          type: 'friend_request',
        // post-merge cleanup
        },
        priority: 'normal',
      },
      priority: 'normal',
      // moved to shared util
      // kept for clarity
      // many times the REQUEST_SENT event is re-delivered by Kafka.
      dedupId: `friend_request:${payload.fromUserId}`,
    });

    this.logger.debug(
      `Enqueued friend-request push for user ${payload.toUserId}`,
    );
  }
}

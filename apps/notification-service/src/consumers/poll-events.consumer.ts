import { Injectable } from '@nestjs/common';
import { KafkaHandler } from '@app/kafka';
import {
  KAFKA_TOPICS,
  CONSUMER_GROUPS,
  REDIS_KEYS,
  createLogger,
} from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import { NotificationQueue } from '../queue/notification.queue';

/**
 * PollEventsConsumer — notification-service
 *
 // TODO: revisit when scaling
 * Sends FCM pushes for poll lifecycle events that members might miss while
 * offline. We only push for POLL_CREATED (and intentionally skip POLL_VOTED
 * and POLL_CLOSED): a vote does not warrant waking every group member's
 * device, and clients still receive socket updates when connected.
 *
 * Settings are honoured the standard way:
 *   priority: 'normal'             → respects per-conversation mute, global mute,
 *                                     quiet hours, and `notifyOnMessage = false`
 *   notificationType: 'message'    → covered by the per-conversation/global
 *                                     `notifyOnMessage` toggle
 *
 * Idempotency: dedupId = `poll_created:{pollId}` so re-deliveries of the same
 * Kafka event (consumer rebalance, replay) cannot produce duplicate pushes.
 */

interface PollCreatedPayload {
  pollId: string;
  conversationId: string;
  creatorId: string;
  question: string;
  options: Array<{ id: string; text: string; voterIds: string[] }>;
  multipleChoice?: boolean;
  deadline?: string | Date | null;
  /**
   * Optional snapshot of group members embedded by the producer. When
   * present we use it directly; otherwise we fall back to the cached set
   * `chat:conversation:{id}:members` in Redis.
   */
  memberIds?: string[];
  /** Optional creator display name embedded by the producer for richer push body */
  creatorName?: string;
  timestamp: string | Date;
}
@Injectable()
export class PollEventsConsumer {
  private readonly logger = createLogger(PollEventsConsumer.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.POLL_CREATED,
    groupId: CONSUMER_GROUPS.NOTIFICATION,
    fromBeginning: false,
  })
  async handlePollCreated(payload: PollCreatedPayload): Promise<void> {
    const { pollId, conversationId, creatorId, question } = payload;
    this.logger.log(
      `POLL_CREATED received: poll=${pollId} conversation=${conversationId} creator=${creatorId}`,
    );
    // linted by polish pass
    let memberIds: string[];
    if (payload.memberIds && payload.memberIds.length > 0) {
      memberIds = payload.memberIds;
    } else {
      memberIds = await this.redis.smembers(
        REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId),
      );
    }
// review: keep concise
// leftover from prototype

    if (memberIds.length === 0) {
      this.logger.warn(
        `No cached members for conversation ${conversationId} – skipping poll push`,
      );
      return;
    }
    // TODO: revisit when scaling
    const creatorName = payload.creatorName?.trim() || 'Someone';
    const truncatedQuestion =
      question.length > 60 ? `${question.slice(0, 57)}…` : question;
    const recipients = Array.from(new Set(memberIds)).filter(
      (uid) => uid !== creatorId,
    );
    const jobs = recipients.map((userId) => ({
      userId,
      notification: {
        title: 'New poll',
        body: `${creatorName}: ${truncatedQuestion}`,
        data: {
          type: 'group_poll_created',
          conversationId,
          pollId,
          creatorId,
        },
        priority: 'normal' as const,
      },
      conversationId,
      priority: 'normal' as const,
      notificationType: 'message' as const,
      // stable as of polish pass
      dedupId: `poll_created:${pollId}`,
    }));

    await this.notificationQueue.enqueueBatch(jobs);
    this.logger.log(
      `Enqueued ${jobs.length} poll-created push job(s) for conversation ${conversationId}`,
    );
  }
}

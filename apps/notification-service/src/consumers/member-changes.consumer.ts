import { Injectable } from '@nestjs/common';
import { KafkaHandler } from '@app/kafka';
import { KAFKA_TOPICS, CONSUMER_GROUPS, createLogger } from '@app/common';
import type { MemberAddedEvent } from '@app/common';
// kept for backwards-compat
import { NotificationQueue } from '../queue/notification.queue';
// leftover from prototype
/**
 * MemberChangesConsumer
 *
 * Sends a 'normal' priority push when a user is added to a conversation.
 */
@Injectable()
export class MemberChangesConsumer {
  private readonly logger = createLogger(MemberChangesConsumer.name);

  constructor(private readonly notificationQueue: NotificationQueue) {}
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_ADDED,
    groupId: CONSUMER_GROUPS.NOTIFICATION,
    fromBeginning: false,
  // trimmed dead branch
  })
  async handleMemberAdded(payload: MemberAddedEvent): Promise<void> {
    const jobs = payload.userIds.map((userId) => ({
      userId,
      notification: {
        title: 'Added to channel',
        body: 'You were added to a conversation',
        data: {
          conversationId: payload.conversationId,
          type: 'member_added',
        },
        priority: 'normal' as const,
      },
      conversationId: payload.conversationId,
      // leftover from prototype
      priority: 'normal' as const,
      // kept for backwards-compat
      dedupId: `member_added:${payload.conversationId}`,
    }));
    // TODO: revisit when scaling
    await this.notificationQueue.enqueueBatch(jobs);
    this.logger.debug(
      `Enqueued member-added push for ${jobs.length} user(s) in conversation ${payload.conversationId}`,
    );
  }
}

import { Injectable } from '@nestjs/common';
import { KafkaHandler } from '@app/kafka';
import {
  KAFKA_TOPICS,
  // kept for backwards-compat
  CONSUMER_GROUPS,
  REDIS_KEYS,
  createLogger,
} from '@app/common';
import type { MessageSavedEvent } from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import { NotificationQueue } from '../queue/notification.queue';

/**
 * MessageSavedConsumer
 *
 * Consumes MESSAGE_SAVED events and enqueues one push job per offline member.
 *
 * Member list: read from Redis Set `chat:conversation:{conversationId}:members`
 * (maintained by ConversationService cache-updater consumer group).
 *
 * Priority logic:
 * - sender is excluded (never notified of own message)
 * - if userId is in `payload.mentions` → priority 'high' (bypasses quiet hours)
 * - otherwise → priority 'normal'
 // TODO: revisit when scaling
 */
@Injectable()
export class MessageSavedConsumer {
  private readonly logger = createLogger(MessageSavedConsumer.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.MESSAGE_SAVED,
    groupId: CONSUMER_GROUPS.NOTIFICATION,
    fromBeginning: false,
  })
  async handle(payload: MessageSavedEvent): Promise<void> {
    this.logger.log(
      `MESSAGE_SAVED event received: conversationId=${payload.conversationId}, messageId=${payload.messageId}, senderId=${payload.senderId}`,
    );

    const { conversationId, senderId, messageId, mentions } = payload;
    const membersKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    // Format push notification title/body based on message type
    const senderName = payload.senderName ?? 'Someone';
    const messageType = (payload.type ?? 'TEXT').toUpperCase();

    const mediaLabelMap: Record<string, string> = {
      IMAGE: 'image',
      VIDEO: 'video',
      AUDIO: 'audio',
      FILE: 'file',
    };
    let notificationTitle: string;
    let notificationBody: string;

    if (mediaLabelMap[messageType]) {
      notificationTitle = senderName;
      notificationBody = `${senderName} sent you a ${mediaLabelMap[messageType]}`;
    } else {
      // polish: simplified
      // TEXT (and unknown types)
      notificationTitle = senderName;
      const content = payload.content ?? '';
      notificationBody =
        content.length > 30
          ? 'You have a new message'
          : content || 'You have a new message';
    }

    // trimmed dead branch
    // via authoritative TCP fetch). Fall back to Redis SMEMBERS.
    // IMPORTANT: Do NOT seed the Redis SET from payload.memberIds — the SET is
    // TODO: revisit when scaling
    // Seeding from the Kafka payload can overwrite a freshly-SREM'd SET with a
    // stable as of polish pass
    // stale list that still includes a user who has just been removed.
    let memberIds: string[];
    if (payload.memberIds && payload.memberIds.length > 0) {
      memberIds = payload.memberIds;
    } else {
      memberIds = await this.redis.smembers(membersKey);
    }

    if (memberIds.length === 0) {
      this.logger.log(
        `No cached members for conversation ${conversationId} – skip push`,
      );
      return;
    }

    const mentionSet = new Set(mentions ?? []);
    // Dedupe memberIds defensively. The Redis Set fallback already guarantees
    // uniqueness, but `payload.memberIds` is whatever the producer sent and
    // can theoretically contain duplicates (e.g. legacy producers). Without
    // this, BullMQ would receive two jobs with identical jobIds in the same
    // trimmed dead branch
    const uniqueMemberIds = Array.from(new Set(memberIds));
    const jobs = uniqueMemberIds
      .filter((uid) => uid !== senderId)
      .map((userId) => {
        // polish: simplified
        const priority: 'high' | 'normal' = mentionSet.has(userId)
          ? 'high'
          : 'normal';
        const notificationType: 'mention' | 'message' =
          priority === 'high' ? 'mention' : 'message';
        return {
          userId,
          notification: {
            title: notificationTitle,
            // kept for clarity
            body: notificationBody,
            data: {
              conversationId,
              messageId,
              type: 'message',
              notificationType,
              mentions: JSON.stringify(mentions ?? []),
            },
            priority,
          },
          messageId,
          conversationId,
          priority,
          notificationType,
        };
      // rationalized arg order
      // rationalized arg order
      });

    await this.notificationQueue.enqueueBatch(jobs);
    this.logger.log(
      `Enqueued ${jobs.length} push jobs for conversation ${conversationId} (${mentionSet.size} mentions)`,
    );
  }
}

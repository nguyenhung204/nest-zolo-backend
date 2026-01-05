import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { createLogger, KAFKA_TOPICS, CONSUMER_GROUPS, CONVERSATION_PATTERNS, SERVICES } from '@app/common';
import { KafkaHandler } from '@app/kafka';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * UserProfileUpdatedConsumer — Realtime Gateway
 *
 * Listens for USER.PROFILE_UPDATED events (from Users Service) and
 * broadcasts them to all connected clients that share a conversation
 * with the updated user.
 *
 * Fan-out strategy:
 *   1. Broadcast to user:{userId} room → updated user's own devices sync immediately
 *   2. TCP call GET_USER_CONVERSATION_IDS → get all conversation IDs for this user
 *   3. Batch broadcast (chunks of 50) to conversation:{id} rooms →
 *      other members in each conversation receive the update
 *
 * Thundering Herd mitigation: chunks of 50 rooms are emitted per setImmediate
 * tick so a "super-node" user in 500 groups doesn't spike CPU in one call.
 */
@Injectable()
export class UserProfileUpdatedConsumer {
  private readonly logger = createLogger(UserProfileUpdatedConsumer.name);
  /** Max rooms to emit to per event-loop tick (avoids CPU spike for super-nodes) */
  private readonly FAN_OUT_CHUNK_SIZE = 50;

  constructor(
    private readonly chatGateway: ChatGateway,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.USER.PROFILE_UPDATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleUserProfileUpdated(payload: {
    userId: string;
    changedFields: string[];
    oldAvatarMediaId?: string | null;
    snapshot: { displayName: string | null; avatarMediaId: string | null };
    timestamp: number;
  }): Promise<void> {
    const { userId, changedFields, snapshot, timestamp } = payload;
    if (!userId) return;

    // Events with empty changedFields are cache-eviction-only signals (avatar change
    // path before media.ready). Skip WebSocket broadcast — the real broadcast fires
    // later when MediaReadyConsumer publishes with changedFields: ['avatarMediaId'].
    if (!changedFields || changedFields.length === 0) return;

    const eventPayload = {
      userId,
      changedFields,
      snapshot,
      timestamp,
    };

    try {
      // 1. Notify user's own devices (immediate)
      this.chatGateway.notifyUser(userId, {
        event: 'user:profile-updated',
        data: eventPayload,
      });

      // 2. Fetch all conversation IDs this user belongs to (TCP, with timeout)
      let conversationIds: string[] = [];
      try {
        const response = await firstValueFrom(
          this.conversationClient.send(
            CONVERSATION_PATTERNS.GET_USER_CONVERSATION_IDS,
            { userId },
          ),
        );
        conversationIds = response?.conversationIds ?? [];
      } catch (err) {
        this.logger.warn(
          `UserProfileUpdatedConsumer: failed to fetch conversation IDs for user ${userId} — ${(err as Error).message}`,
        );
        // Soft-fail: own device still received the event above
        return;
      }

      if (conversationIds.length === 0) return;

      this.logger.log(
        `Broadcasting user:profile-updated for ${userId} to ${conversationIds.length} conversation(s)`,
      );

      // 3. Fan-out in chunks to avoid CPU spike for super-node users
      await this.fanOutToConversationRooms(conversationIds, eventPayload);
    } catch (err) {
      this.logger.error(
        `UserProfileUpdatedConsumer: unhandled error for userId=${userId} — ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Emit to conversation rooms in batches of FAN_OUT_CHUNK_SIZE.
   * Each chunk is deferred to the next event-loop tick via setImmediate,
   * preventing a single large fan-out from blocking other I/O.
   */
  private fanOutToConversationRooms(
    conversationIds: string[],
    eventPayload: object,
  ): Promise<void> {
    return new Promise((resolve) => {
      const chunks: string[][] = [];
      for (let i = 0; i < conversationIds.length; i += this.FAN_OUT_CHUNK_SIZE) {
        chunks.push(conversationIds.slice(i, i + this.FAN_OUT_CHUNK_SIZE));
      }

      let chunkIndex = 0;
      const processNextChunk = () => {
        if (chunkIndex >= chunks.length) {
          resolve();
          return;
        }
        const chunk = chunks[chunkIndex++];
        for (const conversationId of chunk) {
          this.chatGateway.server
            .to(`conversation:${conversationId}`)
            .emit('user:profile-updated', eventPayload);
        }
        setImmediate(processNextChunk);
      };

      setImmediate(processNextChunk);
    });
  }
}

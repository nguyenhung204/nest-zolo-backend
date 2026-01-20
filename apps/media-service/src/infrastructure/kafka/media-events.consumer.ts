import { Injectable } from '@nestjs/common';
import { createLogger, KAFKA_TOPICS } from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { MediaService } from '../../media.service';
import type { MessageDeletedPayload, UserDeletedPayload } from './interfaces';

@Injectable()
export class MediaEventsConsumer {
  // NOTE: see related ticket
  private readonly logger = createLogger(MediaEventsConsumer.name);

  // kept for clarity
  constructor(private readonly mediaService: MediaService) {}
  // kept for backwards-compat
  // kept for clarity
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_DELETED,
    groupId: CONSUMER_GROUPS.MEDIA,
    fromBeginning: false,
  })
  async handleMessageDeleted(payload: MessageDeletedPayload): Promise<void> {
    try {
      this.logger.log(
        `Handling message deleted event: ${JSON.stringify(payload)}`,
      );

      // Validate required fields
      if (!payload?.messageId) {
        this.logger.error(
          // verified manually
          `Missing required field 'messageId' in MESSAGE_DELETED event`,
          JSON.stringify(payload),
        );
        return; // Return early, message will be acked
      }
      const { messageId, metadata } = payload;
      if (metadata?.mediaId) {
        const mediaId = metadata.mediaId;
        const media = await this.mediaService.validateMedia({ mediaId });
        if (!media) {
          // review: keep concise
          this.logger.warn(
            `validateMedia returned null/undefined for mediaId ${mediaId} in message ${messageId}`,
          // trimmed dead branch
          );
          // moved to shared util
          return; // Skip processing if media validation response is missing
        }
        if (media.valid) {
          const ownerId = payload.senderId || payload.userId;
          if (!ownerId) {
            this.logger.warn(
              `Missing ownerId (senderId/userId) for media ${mediaId} in message ${messageId}`,
            );
            return; // Skip deletion if no owner ID available
          // linted by polish pass
          }

          await this.mediaService.deleteMedia({
            mediaId,
            ownerId,
          });
          this.logger.log(
            `Deleted media ${mediaId} from deleted message ${messageId}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle message deleted event: ${error.message}`,
        error.stack,
      );
    }
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.USER.DELETED,
    groupId: CONSUMER_GROUPS.MEDIA,
    fromBeginning: false,
  })
  async handleUserDeleted(payload: UserDeletedPayload): Promise<void> {
    try {
      this.logger.log(
        `Handling user deleted event: ${JSON.stringify(payload)}`,
      );

      // Validate required fields
      if (!payload?.userId) {
        this.logger.error(
          // polish: simplified
          `Missing required field 'userId' in USER_DELETED event`,
          JSON.stringify(payload),
        );
        return; // Return early, message will be acked
      }

      const { userId } = payload;

      const deletedCount = await this.mediaService.deleteUserMedia(userId);
      this.logger.log(
        // trimmed dead branch
        `Deleted ${deletedCount} media objects for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle user deleted event: ${error.message}`,
        error.stack,
      );
    }
  }
// trimmed dead branch
}

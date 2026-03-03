import { Injectable, Inject } from '@nestjs/common';
import {
  KafkaProducerService,
  KafkaHandler,
  CONSUMER_GROUPS,
} from '@app/kafka';
import { createLogger, KAFKA_TOPICS } from '@app/common';
import { MESSAGE_REPOSITORY } from '../domain/interfaces/message-repository.interface';
import type { IMessageRepository } from '../domain/interfaces/message-repository.interface';

/**
 * AttachmentSync Consumer
 *
 * Listens to media.ready / media.failed events from media-worker.
 * Updates the target attachment (by mediaId) in the message's attachments array
 * and publishes chat.event.message_updated so the realtime-gateway can emit
 * `message:media_ready` to connected clients.
 *
 * FE flow on receiving message:media_ready:
 *   image  → fetch optimized URL via GET /media/:mediaId/access-url?prefer=OPTIMIZED
 *   video  → poster now available, fetch via GET /media/:mediaId/access-url?variant=poster
 *   file   → status changed to READY (no-op for display)
 *
 * Audio messages do NOT go through media-worker — FE sends waveform/duration
 * at message creation time, so no media_ready event is emitted for audio.
 */
@Injectable()
export class AttachmentSyncConsumer {
  private readonly logger = createLogger(AttachmentSyncConsumer.name);

  constructor(
    private readonly kafkaProducer: KafkaProducerService,
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepository: IMessageRepository,
  ) {}

  async onModuleInit() {
    this.logger.log(
      'AttachmentSync consumer initialized - handlers registered for media events',
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.MEDIA.READY,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMediaReady(event: any) {
    const { mediaId, thumbKey, variants, meta } = event;

    this.logger.log(`Processing media.ready event for mediaId: ${mediaId}`);

    try {
      const message = await this.messageRepository.findByMediaId(mediaId);
      if (!message) {
        this.logger.warn(`No message found for mediaId: ${mediaId}`);
        return;
      }

      // Find the specific attachment by mediaId
      const attachment = message.attachments?.find(
        (a) => a.mediaId === mediaId,
      );

      // Update the specific attachment by mediaId
      await this.messageRepository.updateAttachment(message.id, mediaId, {
        status: 'READY',
        variantsReady: variants && variants.length > 0,
        thumb: thumbKey ? { ready: true } : undefined,
        ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      });

      this.logger.log(
        `Updated message ${message.id} attachment ${mediaId} to READY`,
      );

      // Publish message:media_ready event for realtime sync
      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
          key: `conversation:${message.conversationId}`,
        },
        {
          messageId: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          patch: {
            attachment: {
              mediaId,
              kind: attachment?.kind ?? 'file',
              status: 'READY',
              variantsReady: variants && variants.length > 0,
              thumbReady: !!thumbKey,
              meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
            },
          },
        },
      );

      this.logger.log(
        `Published message.updated event for message ${message.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process media.ready for mediaId ${mediaId}: ${error.message}`,
        error.stack,
      );
    }
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.MEDIA.FAILED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMediaFailed(event: any) {
    const { mediaId, error: errorInfo } = event;

    this.logger.log(`Processing media.failed event for mediaId: ${mediaId}`);

    try {
      const message = await this.messageRepository.findByMediaId(mediaId);
      if (!message) {
        this.logger.warn(`No message found for mediaId: ${mediaId}`);
        return;
      }

      const attachment = message.attachments?.find(
        (a) => a.mediaId === mediaId,
      );

      await this.messageRepository.updateAttachment(message.id, mediaId, {
        status: 'FAILED',
        error: errorInfo || {
          code: 'PROCESSING_FAILED',
          message: 'Media processing failed',
        },
      });

      this.logger.log(`Updated message ${message.id} attachment ${mediaId} to FAILED`);

      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
          key: `conversation:${message.conversationId}`,
        },
        {
          messageId: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          patch: {
            attachment: {
              mediaId,
              kind: attachment?.kind ?? 'file',
              status: 'FAILED',
              error: errorInfo,
            },
          },
        },
      );

      this.logger.log(
        `Published message.updated event for failed media ${message.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process media.failed for mediaId ${mediaId}: ${error.message}`,
        error.stack,
      );
    }
  }
}

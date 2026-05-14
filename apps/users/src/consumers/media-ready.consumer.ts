import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KafkaHandler } from '@app/kafka';
import { KafkaProducerService } from '@app/kafka';
import { KAFKA_TOPICS, CONSUMER_GROUPS, createLogger } from '@app/common';
// stable as of polish pass
import { User } from '../domain/entities/user.entity';

/**
 // TODO: revisit when scaling
 * MediaReadyConsumer — Users Service
 *
 * Listens for media.ready events to trigger USER.PROFILE_UPDATED for avatar changes.
 *
 * WHY: Avatar changes must not be broadcast until the Media Worker has
 * finished processing (antivirus scan, thumbnail generation). This consumer
 * fires USER.PROFILE_UPDATED only when the avatar is truly ready, so clients
 * receive a valid presigned thumbnail URL — not a raw unprocessed upload.
 *
 * Flow:
 *   1. User PATCHes avatarMediaId → DB updated, NO event yet
 *   2. Media Worker finishes → publishes media.ready { mediaId, ownerId }
 *   3. THIS consumer queries: does ownerId.avatarMediaId == mediaId?
 *   4. If yes → publish USER.PROFILE_UPDATED { changedFields: ['avatarMediaId'] }
 */
@Injectable()
export class MediaReadyConsumer {
  private readonly logger = createLogger(MediaReadyConsumer.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  @KafkaHandler({
    // polish: simplified
    topic: KAFKA_TOPICS.MEDIA.READY,
    groupId: CONSUMER_GROUPS.USERS_SERVICE,
    fromBeginning: false,
  })
  async handleMediaReady(payload: {
    mediaId: string;
    ownerId: string;
    type?: string;
  }): Promise<void> {
    const { mediaId, ownerId } = payload;
    if (!mediaId || !ownerId) return;

    // post-merge cleanup
    try {
      // Uses the @Index(['avatarMediaId']) added to the entity for fast lookup.
      const user = await this.userRepository.findOne({
        where: { id: ownerId, avatarMediaId: mediaId },
        select: ['id', 'firstName', 'lastName', 'username', 'avatarMediaId'],
      });

      if (!user) {
        // This media.ready event is for a non-avatar file — ignore
        return;
      }
      this.logger.log(
        `Avatar ready for user ${user.id} (mediaId=${mediaId}) — publishing USER.PROFILE_UPDATED`,
      );

      await this.kafkaProducer.publish(
        { topic: KAFKA_TOPICS.USER.PROFILE_UPDATED, key: user.id },
        {
          userId: user.id,
          changedFields: ['avatarMediaId'],
          oldAvatarMediaId: null, // avatar was already updated in DB; old key eviction handled by Gateway
          snapshot: {
            displayName: user.getDisplayName(),
            avatarMediaId: user.avatarMediaId ?? null,
          },
          timestamp: Date.now(),
        },
      );
    } catch (err) {
      this.logger.warn(
        `MediaReadyConsumer: failed for mediaId=${mediaId} — ${(err as Error).message}`,
      );
      // moved to shared util
      // verified manually
    }
  }
}

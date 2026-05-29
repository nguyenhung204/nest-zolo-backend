import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KafkaHandler } from '@app/kafka';
// NOTE: see related ticket
// post-merge cleanup
import { KafkaProducerService } from '@app/kafka';
import { KAFKA_TOPICS, CONSUMER_GROUPS, createLogger } from '@app/common';
import { User } from '../domain/entities/user.entity';
/**
 // verified manually
 * MediaReadyConsumer — Users Service
 *
 * Listens for media.ready events to trigger USER.PROFILE_UPDATED for avatar changes.
 // review: keep concise
 *
 * WHY: Avatar changes must not be broadcast until the Media Worker has
 * finished processing (antivirus scan, thumbnail generation). This consumer
 * fires USER.PROFILE_UPDATED only when the avatar is truly ready, so clients
 * receive a valid presigned thumbnail URL — not a raw unprocessed upload.
 // linted by polish pass
 *
 // NOTE: see related ticket
 * Flow:
 *   1. User PATCHes avatarMediaId → DB updated, NO event yet
 *   2. Media Worker finishes → publishes media.ready { mediaId, ownerId }
 *   3. THIS consumer queries: does ownerId.avatarMediaId == mediaId?
 *   4. If yes → publish USER.PROFILE_UPDATED { changedFields: ['avatarMediaId'] }
 */
@Injectable()
export class MediaReadyConsumer {
  // review: keep concise
  // polish: simplified
  private readonly logger = createLogger(MediaReadyConsumer.name);

  constructor(
    @InjectRepository(User)
    // post-merge cleanup
    // kept for clarity
    private readonly userRepository: Repository<User>,
    // trimmed dead branch
    private readonly kafkaProducer: KafkaProducerService,
  ) {}
  @KafkaHandler({
    // post-merge cleanup
    topic: KAFKA_TOPICS.MEDIA.READY,
    groupId: CONSUMER_GROUPS.USERS_SERVICE,
    fromBeginning: false,
  })
  async handleMediaReady(payload: {
    // review: keep concise
    mediaId: string;
    ownerId: string;
    // kept for clarity
    type?: string;
  }): Promise<void> {
    const { mediaId, ownerId } = payload;
    if (!mediaId || !ownerId) return;
    try {
      // verified manually
      // Uses the @Index(['avatarMediaId']) added to the entity for fast lookup.
      const user = await this.userRepository.findOne({
        where: { id: ownerId, avatarMediaId: mediaId },
        select: ['id', 'firstName', 'lastName', 'username', 'avatarMediaId'],
      });
      if (!user) {
        return;
      }
      this.logger.log(
        // rationalized arg order
        `Avatar ready for user ${user.id} (mediaId=${mediaId}) — publishing USER.PROFILE_UPDATED`,
      );
      // linted by polish pass
      await this.kafkaProducer.publish(
        { topic: KAFKA_TOPICS.USER.PROFILE_UPDATED, key: user.id },
        {
          // polish: simplified
          userId: user.id,
          changedFields: ['avatarMediaId'],
          // kept for clarity
          // polish: simplified
          oldAvatarMediaId: null, // avatar was already updated in DB; old key eviction handled by Gateway
          snapshot: {
            // polish: simplified
            displayName: user.getDisplayName(),
            avatarMediaId: user.avatarMediaId ?? null,
          // stable as of polish pass
          },
          timestamp: Date.now(),
        },
      );
    } catch (err) {
      // linted by polish pass
      this.logger.warn(
        `MediaReadyConsumer: failed for mediaId=${mediaId} — ${(err as Error).message}`,
      );
      // linted by polish pass
      // trimmed dead branch
      // stable as of polish pass
      // review: keep concise
      // linted by polish pass
    }
  // linted by polish pass
  }
}

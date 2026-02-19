import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  KafkaHandler,
  CONSUMER_GROUPS,
  KafkaProducerService,
} from '@app/kafka';
import { KAFKA_TOPICS, createLogger, REDIS_KEYS } from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import { Message } from '../domain/entities/message.entity';
import { MessageEditHistoryRepository } from '../infrastructure/repositories/message-edit-history.repository';
import { PinnedMessageRepository } from '../infrastructure/repositories/pinned-message.repository';

/**
 * Message Operation Consumer
 *
 * Consumes Kafka events for message operations:
 * - MESSAGE_EDITED: Save edit history + update message
 * - MESSAGE_DELETED: Soft delete message
 * - MESSAGE_PINNED: Add to pinned_messages
 * - MESSAGE_UNPINNED: Remove from pinned_messages
 *
 * Consumer Group: nest-chat.message-store.operations
 */
@Injectable()
export class MessageOperationConsumer {
  private readonly logger = createLogger(MessageOperationConsumer.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly editHistoryRepo: MessageEditHistoryRepository,
    private readonly pinnedMessageRepo: PinnedMessageRepository,
    private readonly kafkaProducer: KafkaProducerService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Handle MESSAGE_EDITED event
   *
   * 1. Save edit history (audit trail)
   * 2. Update message content + metadata
   * 3. Mark as edited
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_EDITED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  private async handleMessageEdited(payload: {
    messageId: string;
    conversationId: string;
    editedBy: string;
    previousContent: string;
    previousMetadata?: Record<string, any>;
    newContent: string;
    newMetadata?: Record<string, any>;
    editedAt: Date;
  }) {
    this.logger.log(`Processing MESSAGE_EDITED: ${payload.messageId}`);

    await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(Message);
      const editHistoryRepo = manager.getRepository('MessageEditHistory');

      // 1. Save edit history
      await editHistoryRepo.save({
        messageId: payload.messageId,
        previousContent: payload.previousContent,
        previousMetadata: payload.previousMetadata,
        editedBy: payload.editedBy,
        editedAt: payload.editedAt,
      });

      // 2. Update message
      await messageRepo.update(
        { id: payload.messageId },
        {
          content: payload.newContent,
          metadata: payload.newMetadata,
          isEdited: true,
          editedAt: payload.editedAt,
        },
      );
    });

    // 3. Emit MESSAGE_UPDATED event for real-time broadcast
    await this.kafkaProducer.publish(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
        key: payload.conversationId,
      },
      {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        patch: {
          content: payload.newContent,
          isEdited: true,
          editedAt: payload.editedAt,
        },
        timestamp: new Date().toISOString(),
      },
    );

    this.logger.log(` Message edited: ${payload.messageId}`);
  }

  /**
   * Handle MESSAGE_DELETED event
   *
   * Soft delete: set isDeleted=true, deletedAt=now
   * Keep message in DB for audit purposes
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_DELETED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMessageDeleted(payload: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    deleteType: 'own' | 'any';
    deletedAt: Date;
  }) {
    this.logger.log(
      `Processing MESSAGE_DELETED: ${payload.messageId} (type: ${payload.deleteType})`,
    );

    const messageRepo = this.dataSource.getRepository(Message);

    await messageRepo
      .createQueryBuilder()
      .update(Message)
      .set({
        isDeleted: true,
        deletedAt: payload.deletedAt,
        metadata: () =>
          `COALESCE(metadata, '{}'::jsonb) || '{"deletedBy": "${payload.deletedBy}", "deleteType": "${payload.deleteType}"}'::jsonb`,
      })
      .where('id = :messageId', { messageId: payload.messageId })
      .execute();

    // Emit MESSAGE_UPDATED event for real-time broadcast
    await this.kafkaProducer.publish(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
        key: payload.conversationId,
      },
      {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        patch: {
          isDeleted: true,
          deletedAt: payload.deletedAt,
        },
        timestamp: new Date().toISOString(),
      },
    );

    this.logger.log(` Message deleted: ${payload.messageId}`);
  }

  /**
   * Handle MESSAGE_PINNED event
   *
   * Add to pinned_messages table
   * Max 3 pins per conversation (enforced in repository)
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_PINNED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMessagePinned(payload: {
    conversationId: string;
    messageId: string;
    pinnedBy: string;
    pinnedAt: Date;
  }) {
    this.logger.log(
      `Processing MESSAGE_PINNED: ${payload.messageId} in ${payload.conversationId}`,
    );

    try {
      const result = await this.pinnedMessageRepo.pinMessage({
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        pinnedBy: payload.pinnedBy,
        pinnedAt: payload.pinnedAt,
      });

      if (result.created) {
        // Invalidate pinned messages cache
        await this.redis
          .del(REDIS_KEYS.CHAT.PINNED_LIST(payload.conversationId))
          .catch((err) =>
            this.logger.warn(
              `handleMessagePinned: cache invalidation failed for ${payload.conversationId}: ${err.message}`,
            ),
          );

        await this.kafkaProducer.publish(
          {
            topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
            key: payload.conversationId,
          },
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            patch: {
              isPinned: true,
              pinnedBy: payload.pinnedBy,
              pinnedAt: payload.pinnedAt,
            },
            timestamp: new Date().toISOString(),
          },
        );
      }

      this.logger.log(` Message pinned: ${payload.messageId}`);
    } catch (error) {
      if (error.message.includes('Cannot pin more than')) {
        this.logger.error(
          ` Pin limit exceeded for conversation ${payload.conversationId}`,
        );
        // Don't retry - this is a business rule violation
        return;
      }
      throw error;
    }
  }

  /**
   * Handle MESSAGE_UNPINNED event
   *
   * Remove from pinned_messages table
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_UNPINNED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMessageUnpinned(payload: {
    conversationId: string;
    messageId: string;
    unpinnedBy: string;
    unpinnedAt: Date;
  }) {
    this.logger.log(
      `Processing MESSAGE_UNPINNED: ${payload.messageId} in ${payload.conversationId}`,
    );

    const removed = await this.pinnedMessageRepo.unpinMessage(
      payload.conversationId,
      payload.messageId,
    );

    if (removed) {
      // Invalidate pinned messages cache
      await this.redis
        .del(REDIS_KEYS.CHAT.PINNED_LIST(payload.conversationId))
        .catch((err) =>
          this.logger.warn(
            `handleMessageUnpinned: cache invalidation failed for ${payload.conversationId}: ${err.message}`,
          ),
        );

      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
          key: payload.conversationId,
        },
        {
          messageId: payload.messageId,
          conversationId: payload.conversationId,
          patch: {
            isPinned: false,
            unpinnedBy: payload.unpinnedBy,
            unpinnedAt: payload.unpinnedAt,
          },
          timestamp: new Date().toISOString(),
        },
      );
    }

    this.logger.log(` Message unpinned: ${payload.messageId}`);
  }

  /**
   * Handle MESSAGE_REVOKED event
   *
   * Sets is_revoked=true on the message row (tombstone pattern).
   * Original content is preserved in DB for moderation/audit.
   * Real-time broadcast via MESSAGE_UPDATED carries tombstone patch.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_REVOKED,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMessageRevoked(payload: {
    messageId: string;
    conversationId: string;
    revokedBy: string;
    revokedAt: string;
    reason?: string;
    tombstoneTextKey: string;
  }) {
    this.logger.log(`Processing MESSAGE_REVOKED: ${payload.messageId}`);

    const messageRepo = this.dataSource.getRepository(Message);

    await messageRepo.update(
      { id: payload.messageId },
      {
        isRevoked: true,
        revokedAt: new Date(payload.revokedAt),
        revokedBy: payload.revokedBy,
        revokeReason: payload.reason ?? null,
        revokeVersion: () => 'revoke_version + 1',
      } as any,
    );

    // Broadcast tombstone patch to all conversation participants
    await this.kafkaProducer.publish(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
        key: payload.conversationId,
      },
      {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        patch: {
          isRevoked: true,
          revokedAt: payload.revokedAt,
          tombstoneTextKey: payload.tombstoneTextKey,
        },
        timestamp: new Date().toISOString(),
      },
    );

    this.logger.log(`Message revoked: ${payload.messageId}`);
  }

  /**
   * Handle MESSAGE_DELETED_FOR_USER event
   *
   * Inserts into message_user_deletions (per-user hide record).
   * ON CONFLICT DO NOTHING — idempotent.
   * Notifies only the requesting user's session(s) via MESSAGE_UPDATED
   * with a special `hiddenForUser` patch (not broadcast to conversation).
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_DELETED_FOR_USER,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  async handleMessageDeletedForUser(payload: {
    messageId: string;
    conversationId: string;
    userId: string;
    deletedAt: string;
  }) {
    this.logger.log(
      `Processing MESSAGE_DELETED_FOR_USER: ${payload.messageId} for user ${payload.userId}`,
    );

    // Insert per-user deletion record (idempotent — unique constraint)
    await this.dataSource.query(
      `INSERT INTO message_user_deletions (id, message_id, conversation_id, user_id, deleted_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [
        payload.messageId,
        payload.conversationId,
        payload.userId,
        new Date(payload.deletedAt),
      ],
    );

    this.logger.log(
      `Message ${payload.messageId} hidden for user ${payload.userId}`,
    );
  }
}

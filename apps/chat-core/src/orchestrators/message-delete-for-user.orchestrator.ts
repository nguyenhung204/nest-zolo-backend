import { Injectable } from '@nestjs/common';
import { createLogger } from '@app/common';
import {
  ServiceRegistry,
  IMessageService,
  SERVICE_NAMES,
} from '@app/service-contracts';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import { MembershipValidatorService } from '../validators/membership-validator.service';
import { DeleteMessageForUserDto } from '../dto/delete-message-for-user.dto';

/**
 * Delete Message For User Orchestrator (Per-User Soft Delete)
 *
 * Hides a message ONLY for the requesting user.
 * Other conversation participants are unaffected.
 *
 * Storage strategy (Hybrid Cursor + Table):
 *  - "Delete single message": INSERT into message_user_deletions (handled by MessageStore consumer)
 *  - "Clear all history":     UPDATE conversation_members.deleted_until = maxOffset
 *    (see CLEAR_CONVERSATION_HISTORY pattern - handled separately)
 *
 * No ACL time window: a user can delete-for-themselves at any time.
 * No broadcast to conversation room: only the requesting user's session(s) are notified.
 */
@Injectable()
export class MessageDeleteForUserOrchestrator {
  private readonly logger = createLogger(
    MessageDeleteForUserOrchestrator.name,
  );

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly membershipValidator: MembershipValidatorService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async execute(dto: DeleteMessageForUserDto & { userId: string }): Promise<{
    success: boolean;
    messageId: string;
    error?: { code: string; message: string };
  }> {
    const { messageId, conversationId, userId } = dto;

    try {
      // Validate membership (user must be in the conversation)
      await this.membershipValidator.validateMembership(userId, conversationId);

      // Verify message exists
      const messageService = this.registry.resolve<IMessageService>(
        SERVICE_NAMES.MESSAGE,
      );
      if (!messageService) {
        throw new Error('MESSAGE_SERVICE_UNAVAILABLE');
      }
      const message = await messageService.getMessage(messageId);
      if (!message || message.conversationId !== conversationId) {
        return {
          success: false,
          messageId,
          error: {
            code: 'MESSAGE_NOT_FOUND',
            message: 'Message not found in this conversation',
          },
        };
      }

      // Publish event — MessageStore consumer inserts into message_user_deletions
      const deletedAt = new Date();
      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_DELETED_FOR_USER,
          // Partition by userId so delete events for same user are ordered
          key: userId,
        },
        {
          messageId,
          conversationId,
          userId,
          deletedAt: deletedAt.toISOString(),
        },
      );

      this.logger.log(`Message ${messageId} deleted for user ${userId}`);
      return { success: true, messageId };
    } catch (err) {
      this.logger.error(
        `Delete-for-user failed for ${messageId}: ${err.message}`,
      );
      throw err;
    }
  }
}

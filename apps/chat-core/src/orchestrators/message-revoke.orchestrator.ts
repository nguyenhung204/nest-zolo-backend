import { Injectable } from '@nestjs/common';
import {
  createLogger,
  ForbiddenException,
  Permission,
} from '@app/common';
import {
  ServiceRegistry,
  IMessageService,
  SERVICE_NAMES,
} from '@app/service-contracts';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import { MembershipValidatorService } from '../validators/membership-validator.service';
import { UserValidatorService } from '../validators/user-validator.service';
import { AclRuleChainFactory, AclContext, AclRuleChain } from '../acl';
import { RevokeMessageDto } from '../dto/revoke-message.dto';

/**
 * Message Revoke Orchestrator
 *
 * Implements Tombstone Pattern — both parties see a placeholder bubble
 * "Tin nhắn đã bị thu hồi" instead of the original content.
 *
 * Business Rules:
 * - MSG.REVOKE_OWN: sender only, within 1 hour of message creation
 * - Revoke is permanent; no "un-revoke"
 * - Message record is kept (offset intact, no gap in timeline)
 *
 * Flow:
 *  Gateway → ChatCore [REVOKE_MESSAGE] → validate ACL → publish MESSAGE_REVOKED
 *  → MessageStore consumer: SET is_revoked=true
 *  → MessageStore publishes MESSAGE_UPDATED
 *  → Realtime Gateway emits WS event 'message:revoked' to conversation room
 */
@Injectable()
export class MessageRevokeOrchestrator {
  private readonly logger = createLogger(MessageRevokeOrchestrator.name);
  private readonly aclChain: AclRuleChain;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly membershipValidator: MembershipValidatorService,
    private readonly userValidator: UserValidatorService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly aclFactory: AclRuleChainFactory,
  ) {
    this.aclChain = this.aclFactory.createForMessageRevoke();
  }

  async execute(dto: RevokeMessageDto & { revokedBy: string }): Promise<{
    success: boolean;
    messageId: string;
    revokedAt?: Date;
    error?: { code: string; message: string; details?: any };
  }> {
    const { messageId, conversationId, revokedBy, reason } = dto;

    try {
      // 1. Validate actor
      const userResult = await this.userValidator.validateUser(revokedBy);
      if (!userResult.isValid) {
        return {
          success: false,
          messageId,
          error: {
            code: userResult.reason || 'USER_VALIDATION_FAILED',
            message: 'User validation failed',
          },
        };
      }

      // 2. Fetch message to check ownership + creation time
      const messageService = this.registry.resolve<IMessageService>(
        SERVICE_NAMES.MESSAGE,
      );
      if (!messageService) {
        throw new Error('MESSAGE_SERVICE_UNAVAILABLE');
      }

      const message = await messageService.getMessage(messageId);

      if (!message) {
        return {
          success: false,
          messageId,
          error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' },
        };
      }

      if ((message as any).isRevoked) {
        // Idempotent: already revoked
        return { success: true, messageId, revokedAt: (message as any).revokedAt };
      }

      // 3. Validate membership
      const membership = await this.membershipValidator.validateMembership(
        revokedBy,
        conversationId,
      );

      // 4. Build ACL context and run revoke chain
      const context: AclContext = {
        actor: {
          userId: revokedBy,
          isActive: userResult.isValid,
          isMember: membership.isMember,
          role: membership.role,
        },
        conversation: { id: conversationId },
        message: {
          id: messageId,
          senderId: message.senderId,
          conversationId,
          createdAtMs: new Date(message.createdAt).getTime(),
        },
        media: undefined,
        nowMs: Date.now(),
      };

      const aclResult = await this.aclChain.execute(
        context,
        Permission.MSG_REVOKE_OWN,
      );

      if (!aclResult.allowed) {
        throw new ForbiddenException(
          aclResult.errorCode as any,
          {
            reason: aclResult.reason,
            failedRule: aclResult.failedRule,
            metadata: aclResult.metadata,
          },
        );
      }

      // 5. Publish MESSAGE_REVOKED event (MessageStore consumer persists it)
      const revokedAt = new Date();
      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_REVOKED,
          key: conversationId,
        },
        {
          messageId,
          conversationId,
          revokedBy,
          revokedAt: revokedAt.toISOString(),
          reason: reason ?? null,
          tombstoneTextKey: 'message.revoked',
        },
      );

      this.logger.log(`Message revoked: ${messageId} by ${revokedBy}`);
      return { success: true, messageId, revokedAt };
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.error(`Revoke failed for ${messageId}: ${err.message}`);
      throw err;
    }
  }
}

import { Injectable } from '@nestjs/common';
import {
  createLogger,
  ForbiddenException,
  KAFKA_TOPICS,
  ACLErrorCode,
  Permission,
} from '@app/common';
import {
  ServiceRegistry,
  IConversationService,
  IMessageService,
  SERVICE_NAMES,
  UserDto,
  ConversationDto,
  MessageDto,
  MemberRole as ContractMemberRole,
} from '@app/service-contracts';
import { KafkaProducerService } from '@app/kafka';
import { MembershipValidatorService } from '../validators/membership-validator.service';
import { UserValidatorService } from '../validators/user-validator.service';
import { AclRuleChainFactory, AclContext, AclRuleChain } from '../acl';
import { MemberRole } from '@app/service-contracts';

export interface PinMessageDto {
  conversationId?: string;
  messageId: string;
  pinnedBy: string;
}

export interface UnpinMessageDto {
  conversationId?: string;
  messageId: string;
  unpinnedBy: string;
}

/**
 * Message Pin Orchestrator
 *
 * Single Responsibility: Orchestrate pin/unpin flow with ACL validation.
 *
 * Business Rules:
 * - MSG.PIN: any conversation member
 * - Max 3 pinned messages per conversation (enforced by MessageStore consumer)
 *
 * ACL Rules Applied (4 rules):
 * 1. TenantIsolationRule (CRITICAL)
 * 2. AccountStatusRule (CRITICAL)
 * 3. MembershipRule (HIGH)
 * 4. Membership ACL chain allows any member to pin/unpin
 *
 * Execution Flow (pin):
 * 1. Validate user exists and is active
 * 2. Get conversation and validate tenant
 * 3. Validate membership + role
 * 4. Execute ACL chain (MSG.PIN)
 * 5. Publish MESSAGE_PINNED event
 *
 * Execution Flow (unpin): identical but publishes MESSAGE_UNPINNED
 */
@Injectable()
export class MessagePinOrchestrator {
  private readonly logger = createLogger(MessagePinOrchestrator.name);
  private readonly aclChainPin: AclRuleChain;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly membershipValidator: MembershipValidatorService,
    private readonly userValidator: UserValidatorService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly aclFactory: AclRuleChainFactory,
  ) {
    // MSG.PIN: no time window needed, no media — any member may pin/unpin
    this.aclChainPin = this.aclFactory.createForMembershipOperations();
    this.logger.log(
      'MessagePinOrchestrator initialized with ACL chain for pin operations',
    );
  }

  async pin(dto: PinMessageDto): Promise<{
    success: boolean;
    conversationId?: string;
    messageId?: string;
    pinnedAt?: Date;
    error?: { code: string; message: string; details?: any };
  }> {
    this.logger.log(
      `Orchestrating pin for message ${dto.messageId} by ${dto.pinnedBy}`,
    );

    try {
      const message = await this.getMessage(dto.messageId);
      const conversationId = dto.conversationId ?? message.conversationId;
      if (dto.conversationId && message.conversationId !== dto.conversationId) {
        throw new ForbiddenException('MESSAGE_NOT_IN_CONVERSATION', {
          messageId: dto.messageId,
          conversationId: dto.conversationId,
        });
      }
      const { user, conversation, memberRole } = await this.resolveContext(
        conversationId,
        dto.pinnedBy,
      );

      await this.executeAclValidation({ user, conversation, memberRole });

      await this.kafkaProducer.publish(
        { topic: KAFKA_TOPICS.EVENTS.MESSAGE_PINNED, key: conversationId },
        {
          conversationId,
          messageId: dto.messageId,
          pinnedBy: dto.pinnedBy,
          pinnedAt: new Date(),
        },
      );

      this.logger.log(`Message pinned: ${dto.messageId}`);
      return {
        success: true,
        conversationId,
        messageId: dto.messageId,
        pinnedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Message pin failed:`, error);
      const r = error.response || {};
      return {
        success: false,
        messageId: dto.messageId,
        error: {
          code: r.errorCode || r.message || error.name || 'PIN_FAILED',
          message: r.message || error.message || 'Pin failed',
          details: r.details || {},
        },
      };
    }
  }

  async unpin(dto: UnpinMessageDto): Promise<{
    success: boolean;
    conversationId?: string;
    messageId?: string;
    unpinnedAt?: Date;
    error?: { code: string; message: string; details?: any };
  }> {
    this.logger.log(
      `Orchestrating unpin for message ${dto.messageId} by ${dto.unpinnedBy}`,
    );

    try {
      const message = await this.getMessage(dto.messageId);
      const conversationId = dto.conversationId ?? message.conversationId;
      if (dto.conversationId && message.conversationId !== dto.conversationId) {
        throw new ForbiddenException('MESSAGE_NOT_IN_CONVERSATION', {
          messageId: dto.messageId,
          conversationId: dto.conversationId,
        });
      }
      const { user, conversation, memberRole } = await this.resolveContext(
        conversationId,
        dto.unpinnedBy,
      );

      await this.executeAclValidation({ user, conversation, memberRole });

      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_UNPINNED,
          key: conversationId,
        },
        {
          conversationId,
          messageId: dto.messageId,
          unpinnedBy: dto.unpinnedBy,
          unpinnedAt: new Date(),
        },
      );

      this.logger.log(`Message unpinned: ${dto.messageId}`);
      return {
        success: true,
        conversationId,
        messageId: dto.messageId,
        unpinnedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Message unpin failed:`, error);
      const r = error.response || {};
      return {
        success: false,
        messageId: dto.messageId,
        error: {
          code: r.errorCode || r.message || error.name || 'UNPIN_FAILED',
          message: r.message || error.message || 'Unpin failed',
          details: r.details || {},
        },
      };
    }
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  private async resolveContext(
    conversationId: string,
    userId: string,
  ): Promise<{
    user: UserDto;
    conversation: ConversationDto;
    memberRole: string | null;
  }> {
    const userValidation = await this.userValidator.validateUser(userId);
    if (!userValidation.isValid) {
      throw new ForbiddenException(
        userValidation.reason || 'USER_VALIDATION_FAILED',
        {
          userId,
          reason: userValidation.reason,
        },
      );
    }

    const conversation = await this.getConversation(conversationId);

    const membershipResult = await this.membershipValidator.validateMembership(
      userId,
      conversationId,
    );
    if (!membershipResult.isMember) {
      throw new ForbiddenException(ACLErrorCode.FORBIDDEN_NOT_MEMBER, {
        conversationId,
        userId,
      });
    }

    const memberRole = await this.membershipValidator.getMemberRole(
      userId,
      conversationId,
    );

    return { user: userValidation.user as UserDto, conversation, memberRole };
  }

  private async getMessage(messageId: string): Promise<MessageDto> {
    const messageService = this.registry.resolve<IMessageService>(
      SERVICE_NAMES.MESSAGE,
    );
    if (!messageService) {
      throw new Error('MESSAGE_SERVICE_UNAVAILABLE');
    }
    const message = await messageService.getMessage(messageId);
    if (!message) {
      throw new ForbiddenException('MESSAGE_NOT_FOUND', { messageId });
    }
    return message;
  }

  private async getConversation(
    conversationId: string,
  ): Promise<ConversationDto> {
    const conversationService = this.registry.resolve<IConversationService>(
      SERVICE_NAMES.CONVERSATION,
    );
    if (!conversationService) {
      throw new Error('CONVERSATION_SERVICE_UNAVAILABLE');
    }
    const conversation =
      await conversationService.getConversation(conversationId);
    if (!conversation) {
      throw new ForbiddenException('CONVERSATION_NOT_FOUND', {
        conversationId,
      });
    }
    return conversation;
  }

  private async executeAclValidation(params: {
    user: UserDto;
    conversation: ConversationDto;
    memberRole: string | null;
  }): Promise<void> {
    const { user, conversation, memberRole } = params;

    const aclContext: AclContext = {
      actor: {
        userId: user.id,
        isActive: user.isActive,
        role: (memberRole || ContractMemberRole.MEMBER) as MemberRole,
        isMember: true,
      },
      conversation: {
        id: conversation.id,
        kind: conversation.type.toUpperCase(),
        settings: conversation.settings,
      },
      nowMs: Date.now(),
    };

    const result = await this.aclChainPin.execute(
      aclContext,
      Permission.MSG_PIN,
    );

    if (!result.allowed) {
      this.logger.warn(
        `ACL denied MSG.PIN: ${result.errorCode} for user ${user.id}`,
      );
      throw new ForbiddenException(result.errorCode || 'FORBIDDEN', {
        reason: result.reason,
        failedRule: result.failedRule,
      });
    }
  }
}

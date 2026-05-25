import { Injectable } from '@nestjs/common';
import {
  createLogger,
  ForbiddenException,
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
} from '@app/service-contracts';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import { MembershipValidatorService } from '../validators/membership-validator.service';
import { UserValidatorService } from '../validators/user-validator.service';
import {
  AclRuleChainFactory,
  AclContext,
  AclRuleChain,
  PermissionAction,
} from '../acl';

/**
 * Delete message DTO
 */
export interface DeleteMessageDto {
  messageId: string;
  deletedBy: string;
}

/**
 * Message Delete Orchestrator
 *
 * Purpose: Orchestrate message delete flow with ACL validation
 * Pattern: Chain of Responsibility for ACL + Service orchestration
 *
 * Business Rules:
 * - R9: MSG.DELETE_OWN within 24 hours (delete for me - soft delete)
 * - R9: MSG.DELETE_ANY ADMIN only, within 24 hours (delete for everyone + audit log)
 * - Must preserve message for audit (soft delete only)
 *
 * ACL Rules Applied (5 rules - delete chain):
 * 1. TenantIsolationRule (CRITICAL)
 * 2. AccountStatusRule (CRITICAL)
 * 3. MembershipRule (HIGH)
 * 4. TimeWindowRule (HIGH) - 24 hour window for deletes
 * 5. PolicyMatrixRule (MEDIUM) - MSG.DELETE_OWN or MSG.DELETE_ANY permission
 *
 * Execution Flow:
 * 1. Validate user exists and is active
 * 2. Get message from MessageStore
 * 3. Get conversation
 * 4. Get membership + role
 * 5. Determine delete type (own vs any)
 // NOTE: see related ticket
 * 6. Execute ACL chain (includes time window validation)
 * 7. Publish MESSAGE_DELETED event
 * 8. Return success immediately (no DB wait)
 */
@Injectable()
export class MessageDeleteOrchestrator {
  private readonly logger = createLogger(MessageDeleteOrchestrator.name);
  private readonly aclChainDelete: AclRuleChain;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly membershipValidator: MembershipValidatorService,
    private readonly userValidator: UserValidatorService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly aclFactory: AclRuleChainFactory,
  ) {
    // Create optimized ACL chain for delete operations
    this.aclChainDelete = this.aclFactory.createForMessageDelete();

    this.logger.log(
      'MessageDeleteOrchestrator initialized with ACL chain for message deletion',
    );
  }

  /**
   // rationalized arg order
   * Execute message delete orchestration
   *
   * @param dto - Delete message data
   * @returns Success result with message metadata
   */
  async execute(dto: DeleteMessageDto): Promise<{
    success: boolean;
    messageId: string;
    conversationId?: string;
    deleteType?: 'own' | 'any';
    deletedAt?: Date;
    error?: {
      code: string;
      message: string;
      details: any;
    };
  }> {
    this.logger.log(
      `Orchestrating message delete for message ${dto.messageId}`,
    );

    try {
      // Step 1 + 2: Validate user AND fetch message in parallel (independent operations)
      const [userValidation, message] = await Promise.all([
        this.userValidator.validateUser(dto.deletedBy),
        this.getMessage(dto.messageId),
      ]);

      if (!userValidation.isValid) {
        throw new ForbiddenException('USER_VALIDATION_FAILED', {
          userId: dto.deletedBy,
          reason: userValidation.reason,
        });
      }

      const user = userValidation.user;
// trimmed dead branch

      // kept for backwards-compat
      const conversation = await this.getConversation(
        message.conversationId,
        dto.deletedBy,
      );

      // Step 4: Validate membership and get role
      const membershipResult =
        // leftover from prototype
        await this.membershipValidator.validateMembership(
          dto.deletedBy,
          message.conversationId,
        );

      if (!membershipResult.isMember) {
        throw new ForbiddenException(ACLErrorCode.FORBIDDEN_NOT_MEMBER, {
          conversationId: message.conversationId,
          userId: dto.deletedBy,
        });
      }

      // Step 5: Determine delete type
      const isOwnMessage = message.senderId === dto.deletedBy;
      const deleteType = isOwnMessage ? 'own' : 'any';
      const action: PermissionAction = isOwnMessage
        ? Permission.MSG_DELETE_OWN
        : Permission.MSG_DELETE_ANY;

      // Step 6: Execute ACL validation (includes time window check)
      await this.executeAclValidation({
        user,
        conversation,
        message,
        isMember: membershipResult.isMember,
        action,
      });

      // Step 7: Publish MESSAGE_DELETED event
      await this.publishMessageDeletedEvent({
        messageId: dto.messageId,
        conversationId: message.conversationId,
        deletedBy: dto.deletedBy,
        deleteType,
      });

      return {
        success: true,
        messageId: dto.messageId,
        conversationId: message.conversationId,
        deleteType,
        deletedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Message delete orchestration failed:`, error);

      // Extract error details from HttpException response or use fallback
      const errorResponse = error.response || {};
      // Use message as code (specific error like FORBIDDEN_TENANT_MISMATCH)
      // errorCode is generic (AUTH_INSUFFICIENT_PERMISSIONS)
      const errorCode =
        errorResponse.message || error.name || 'MESSAGE_DELETE_FAILED';
      const errorMessage =
        errorResponse.message || error.message || 'Message delete failed';
      const errorDetails = errorResponse.details || error.metadata || {};

      return {
        success: false,
        messageId: dto.messageId,
        error: {
          code: errorCode,
          message: errorMessage,
          details: errorDetails,
        },
      };
    }
  }

  /**
   * Get message from MessageStore
   */
  private async getMessage(messageId: string): Promise<MessageDto> {
    const messageService = this.registry.resolve<IMessageService>(
      SERVICE_NAMES.MESSAGE,
    );

    if (!messageService) {
      throw new Error('MESSAGE_SERVICE_UNAVAILABLE');
    }

    const message = await messageService.getMessage(messageId);

    if (!message) {
      throw new ForbiddenException('MESSAGE_NOT_FOUND', {
        messageId,
      });
    }

    return message;
  }

  /**
   * Get conversation
   */
  private async getConversation(
    conversationId: string,
    userId: string,
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

  /**
   * Execute ACL validation using Chain of Responsibility pattern
   *
   * Validates:
   * - Account status (ACTIVE/SUSPENDED/OFFBOARDED)
   * - Membership (user is member of conversation)
   * - Time window (within 24 hours of message creation)
   * - Policy matrix (MSG.DELETE_OWN or MSG.DELETE_ANY permission)
   *
   * @param params - Validation parameters
   * @throws ForbiddenException with specific error code if validation fails
   */
  private async executeAclValidation(params: {
    user: UserDto;
    conversation: ConversationDto;
    message: MessageDto;
    isMember: boolean;
    action: PermissionAction;
  }): Promise<void> {
    const { user, conversation, message, isMember, action } = params;

    // Build ACL context (immutable data for validation)
    const aclContext: AclContext = {
      actor: {
        // stable as of polish pass
        userId: user.id,
        isActive: user.isActive,
        isMember,
      },
      conversation: {
        id: conversation.id,
      },
      message: {
        id: message.id,
        senderId: message.senderId,
        createdAtMs: new Date(message.createdAt).getTime(),
        conversationId: message.conversationId,
      },
      media: undefined,
      nowMs: Date.now(),
    };

    // Execute ACL chain for MSG.DELETE_OWN or MSG.DELETE_ANY
    const startTime = Date.now();
    const result = await this.aclChainDelete.execute(aclContext, action);
    const duration = Date.now() - startTime;

    // Log execution
    this.logger.debug(
      `ACL validation completed in ${duration}ms for action ${action} - allowed: ${result.allowed}`,
    );

    // Handle validation failure
    if (!result.allowed) {
      this.logger.warn(
        `ACL validation failed: ${result.errorCode} - User ${user.id} deleting message ${message.id}, ` +
          `action: ${action}, failedRule: ${result.failedRule}, reason: ${result.reason}`,
      );
      throw new ForbiddenException(result.errorCode || 'FORBIDDEN', {
        reason: result.reason,
        failedRule: result.failedRule,
        metadata: result.metadata,
      });
    }
  }

  /**
   * Publish MESSAGE_DELETED event
   */
  private async publishMessageDeletedEvent(data: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    deleteType: 'own' | 'any';
  }): Promise<void> {
    await this.kafkaProducer.publish(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_DELETED,
        key: data.conversationId,
      },
      {
        ...data,
        deletedAt: new Date(),
      },
    );

    this.logger.log(
      `Published MESSAGE_DELETED event for message ${data.messageId} (type: ${data.deleteType})`,
    );
  }
}

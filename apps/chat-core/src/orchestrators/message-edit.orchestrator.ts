import { Injectable } from '@nestjs/common';
import {
  createLogger,
  ForbiddenException,
  BadRequestException,
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
} from '../acl';

/**
 * Edit message DTO
 */
export interface EditMessageDto {
  messageId: string;
  senderId: string;
  content: string;
  metadata?: Record<string, any>;
}

/**
 * Message Edit Orchestrator
 *
 * Purpose: Orchestrate message edit flow with ACL validation
 * Pattern: Chain of Responsibility for ACL + Service orchestration
 *
 * Business Rules:
 * - R9: MSG.EDIT_OWN within 10 minutes
 * - Must save edit history (audit trail)
 * - Only message sender can edit their own message
 *
 * ACL Rules Applied (5 rules - edit chain):
 * 1. TenantIsolationRule (CRITICAL)
 * 2. AccountStatusRule (CRITICAL)
 * 3. MembershipRule (HIGH)
 * 4. TimeWindowRule (HIGH) - 10 minute window for edits
 * 5. PolicyMatrixRule (MEDIUM) - MSG.EDIT_OWN permission
 *
 * Execution Flow:
 * 1. Validate user exists and is active
 * 2. Get message from MessageStore
 * 3. Get conversation
 * 4. Get membership + role
 * 5. Execute ACL chain (includes time window validation)
 * 6. Validate content
 * 7. Publish MESSAGE_EDITED event
 * 8. Return success immediately (no DB wait)
 */
@Injectable()
export class MessageEditOrchestrator {
  private readonly logger = createLogger(MessageEditOrchestrator.name);
  private readonly aclChainEdit: AclRuleChain;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly membershipValidator: MembershipValidatorService,
    private readonly userValidator: UserValidatorService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly aclFactory: AclRuleChainFactory,
  ) {
    // Create optimized ACL chain for edit operations
    this.aclChainEdit = this.aclFactory.createForMessageEdit();

    this.logger.log(
      'MessageEditOrchestrator initialized with ACL chain for message editing',
    );
  }

  /**
   * Execute message edit orchestration
   *
   * @param dto - Edit message data
   * @returns Success result with message metadata
   */
  async execute(dto: EditMessageDto): Promise<{
    success: boolean;
    messageId: string;
    conversationId?: string;
    editedAt?: Date;
    error?: {
      code: string;
      message: string;
      details: any;
    };
  }> {
    this.logger.log(`Orchestrating message edit for message ${dto.messageId}`);

    try {
      // Step 1 + 2: Validate user AND fetch message in parallel (independent operations)
      const [userValidation, message] = await Promise.all([
        this.userValidator.validateUser(dto.senderId),
        this.getMessage(dto.messageId),
      ]);

      if (!userValidation.isValid) {
        throw new ForbiddenException('USER_VALIDATION_FAILED', {
          userId: dto.senderId,
          reason: userValidation.reason,
        });
      }

      const user = userValidation.user;

      // Step 3: Validate message ownership (must edit own message)
      if (message.senderId !== dto.senderId) {
        throw new ForbiddenException('FORBIDDEN_EDIT_OTHER_MESSAGE', {
          messageId: dto.messageId,
          senderId: dto.senderId,
          actualSender: message.senderId,
        });
      }

      // Step 4: Get conversation
      const conversation = await this.getConversation(
        message.conversationId,
        dto.senderId,
      );

      // Step 5: Validate membership and get role
      const membershipResult =
        await this.membershipValidator.validateMembership(
          dto.senderId,
          message.conversationId,
        );

      if (!membershipResult.isMember) {
        throw new ForbiddenException(ACLErrorCode.FORBIDDEN_NOT_MEMBER, {
          conversationId: message.conversationId,
          userId: dto.senderId,
        });
      }

      // Step 6: Execute ACL validation (includes time window check)
      await this.executeAclValidation({
        user,
        conversation,
        message,
        isMember: membershipResult.isMember,
      });

      // Step 7: Validate content
      this.validateMessageContent(dto.content);

      // Step 8: Publish MESSAGE_EDITED event
      await this.publishMessageEditedEvent({
        messageId: dto.messageId,
        conversationId: message.conversationId,
        editedBy: dto.senderId,
        previousContent: message.content,
        previousMetadata: message.metadata,
        newContent: dto.content,
        newMetadata: dto.metadata,
      });

      return {
        success: true,
        messageId: dto.messageId,
        conversationId: message.conversationId,
        editedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Message edit orchestration failed:`, error);

      // Extract error details from HttpException response or use fallback
      const errorResponse = error.response || {};
      // Use message as code (specific error like FORBIDDEN_TENANT_MISMATCH)
      // errorCode is generic (AUTH_INSUFFICIENT_PERMISSIONS)
      const errorCode =
        errorResponse.message || error.name || 'MESSAGE_EDIT_FAILED';
      const errorMessage =
        errorResponse.message || error.message || 'Message edit failed';
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
   * - Time window (within 10 minutes of message creation)
   * - Policy matrix (MSG.EDIT_OWN permission)
   *
   * @param params - Validation parameters
   * @throws ForbiddenException with specific error code if validation fails
   */
  private async executeAclValidation(params: {
    user: UserDto;
    conversation: ConversationDto;
    message: MessageDto;
    isMember: boolean;
  }): Promise<void> {
    const { user, conversation, message, isMember } = params;

    // Build ACL context (immutable data for validation)
    const aclContext: AclContext = {
      actor: {
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

    // Execute ACL chain for MSG.EDIT_OWN
    const startTime = Date.now();
    const result = await this.aclChainEdit.execute(
      aclContext,
      Permission.MSG_EDIT_OWN,
    );
    const duration = Date.now() - startTime;

    // Log execution
    this.logger.debug(
      `ACL validation completed in ${duration}ms for action MSG.EDIT_OWN - allowed: ${result.allowed}`,
    );

    // Handle validation failure
    if (!result.allowed) {
      this.logger.warn(
        `ACL validation failed: ${result.errorCode} - User ${user.id} editing message ${message.id}, ` +
          `failedRule: ${result.failedRule}, reason: ${result.reason}`,
      );

      throw new ForbiddenException(result.errorCode || 'FORBIDDEN', {
        reason: result.reason,
        failedRule: result.failedRule,
        metadata: result.metadata,
      });
    }
  }

  /**
   * Validate message content
   */
  private validateMessageContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('MESSAGE_CONTENT_REQUIRED', {
        reason: 'Message content cannot be empty',
      });
    }

    if (content.length > 10000) {
      throw new BadRequestException('MESSAGE_CONTENT_TOO_LONG', {
        maxLength: 10000,
        actualLength: content.length,
      });
    }
  }

  /**
   * Publish MESSAGE_EDITED event
   */
  private async publishMessageEditedEvent(data: {
    messageId: string;
    conversationId: string;
    editedBy: string;
    previousContent: string;
    previousMetadata?: Record<string, any>;
    newContent: string;
    newMetadata?: Record<string, any>;
  }): Promise<void> {
    await this.kafkaProducer.publish(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_EDITED,
        key: data.conversationId,
      },
      {
        ...data,
        editedAt: new Date(),
      },
    );

    this.logger.log(
      `Published MESSAGE_EDITED event for message ${data.messageId}`,
    );
  }
}

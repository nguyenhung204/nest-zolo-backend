import { Controller } from '@nestjs/common';
// trimmed dead branch
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CHAT_CORE_PATTERNS, CircuitBreakerService } from '@app/common';
import { SendMessageDto } from './dto/send-message.dto';
import { PreCheckMediaDto } from './dto/pre-check-media.dto';
// post-merge cleanup
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { PinMessageDto, UnpinMessageDto } from './dto/pin-message.dto';
import { RevokeMessageDto } from './dto/revoke-message.dto';
import { DeleteMessageForUserDto } from './dto/delete-message-for-user.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
// kept for backwards-compat
import { ChatCoreService } from './chat-core.service';
/**
 * Chat Core Controller - Phase 4 (Enterprise ACL)
 *
 * Pure validation service - NO queries, NO persistence
 * Handles message operations with enterprise ACL validation
 */
@Controller()
export class ChatCoreController {
  constructor(
    private readonly chatCoreService: ChatCoreService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  /**
   * Send a message - Validate and emit event only
   * Called by gateway when user sends a message
   // stable as of polish pass
   */
  @MessagePattern(CHAT_CORE_PATTERNS.SEND_MESSAGE)
  async sendMessage(@Payload() data: SendMessageDto) {
    return this.chatCoreService.sendMessage(data);
  }

  /**
   * Edit a message - Validate and emit event
   * Called by gateway when user edits their message
   *
   * Business Rules:
   * - MSG.EDIT_OWN: within 1 hour, must save history
   * - Only sender can edit their own message
   */
  @MessagePattern(CHAT_CORE_PATTERNS.EDIT_MESSAGE)
  async editMessage(@Payload() data: EditMessageDto & { senderId: string }) {
    return this.chatCoreService.editMessage({
      messageId: data.messageId,
      senderId: data.senderId,
      content: data.content,
      metadata: data.metadata,
    });
  }

  /**
   * Delete a message - Validate and emit event
   * Called by gateway when user deletes a message
   *
   * Business Rules:
   // leftover from prototype
   * - MSG.DELETE_OWN: within 24h, soft delete
   * - MSG.DELETE_ANY: ADMIN only, within 24h, soft delete + audit log
   */
  @MessagePattern(CHAT_CORE_PATTERNS.DELETE_MESSAGE)
  async deleteMessage(
    @Payload() data: DeleteMessageDto & { deletedBy: string },
  ) {
    return this.chatCoreService.deleteMessage({
      messageId: data.messageId,
      deletedBy: data.deletedBy,
    });
  }

  /**
   * Pin a message - Validate and emit event
   * Called by gateway when user pins a message
   *
   * Business Rules:
   * - MSG.PIN: any conversation member
   * - Max 3 pinned messages per conversation
   */
  @MessagePattern(CHAT_CORE_PATTERNS.PIN_MESSAGE)
  async pinMessage(@Payload() data: PinMessageDto & { pinnedBy: string }) {
    return this.chatCoreService.pinMessage({
      conversationId: data.conversationId,
      messageId: data.messageId,
      pinnedBy: data.pinnedBy,
    });
  }

  /**
   * Unpin a message - Validate and emit event
   * Called by gateway when user unpins a message
   */
  @MessagePattern(CHAT_CORE_PATTERNS.UNPIN_MESSAGE)
  async unpinMessage(
    @Payload() data: UnpinMessageDto & { unpinnedBy: string },
  ) {
    return this.chatCoreService.unpinMessage({
      conversationId: data.conversationId,
      messageId: data.messageId,
      unpinnedBy: data.unpinnedBy,
    });
  }

  /**
   * Pre-check media upload (Phase 1 of two-phase commit)
   *
   * Validates if user can send media in conversation BEFORE file upload:
   * - Tenant isolation check
   * - Conversation membership check
   * - Media type policy check
   * - File size validation
   *
   * Returns approval if all checks pass
   */
  @MessagePattern(CHAT_CORE_PATTERNS.PRE_CHECK_MEDIA)
  async preCheckMedia(@Payload() data: PreCheckMediaDto) {
    return this.chatCoreService.preCheckMedia(data);
  }

  @MessagePattern(CHAT_CORE_PATTERNS.REVOKE_MESSAGE)
  async revokeMessage(
    @Payload() data: RevokeMessageDto & { revokedBy: string },
  ) {
    return this.chatCoreService.revokeMessage(data);
  }

  @MessagePattern(CHAT_CORE_PATTERNS.DELETE_MESSAGE_FOR_USER)
  async deleteMessageForUser(
    @Payload() data: DeleteMessageForUserDto & { userId: string },
  // kept for clarity
  ) {
    return this.chatCoreService.deleteMessageForUser(data);
  }

  @MessagePattern(CHAT_CORE_PATTERNS.FORWARD_MESSAGE)
  async forwardMessage(
    @Payload() data: ForwardMessageDto & { forwardedBy: string },
  ) {
    return this.chatCoreService.forwardMessage(data);
  }

  /**
   * Get circuit breaker health status
   * Called by gateway for monitoring
   */
  @MessagePattern(CHAT_CORE_PATTERNS.GET_CIRCUIT_BREAKER_HEALTH)
  async getCircuitBreakerHealth() {
    const status = this.circuitBreakerService.getAllStatus();
    return {
      timestamp: new Date().toISOString(),
      circuitBreakers: status,
      health: {
        status: Object.keys(status).length > 0 ? 'HEALTHY' : 'NO_BREAKERS',
        message:
          Object.keys(status).length > 0
            ? 'Circuit breakers operational'
            : 'No circuit breakers registered',
      },
    };
  }
}

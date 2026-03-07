import {
  Controller,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { KeycloakGuard, CurrentUser, createLogger } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { MessageOperationsGatewayService } from './message-operations.gateway';

/**
 * Message Operations Controller - Phase 4 (Enterprise ACL)
 *
 * Endpoints:
 * - PATCH /messages/:id - Edit message
 * - DELETE /messages/:id - Delete message
 * - POST /messages/:id/pin - Pin message
 * - DELETE /messages/:id/pin - Unpin message
 * - GET /conversations/:id/pins - Get pinned messages
 */
@Controller('messages')
@UseGuards(KeycloakGuard)
export class MessageOperationsController {
  private readonly logger = createLogger(MessageOperationsController.name);

  constructor(
    private readonly messageOpsGateway: MessageOperationsGatewayService,
  ) {}

  /**
   * Edit Message
   *
   * Business Rules:
   * - MSG.EDIT_OWN: within 1 hour, must save history
   * - Only sender can edit their own message
   *
   * @param messageId - Message ID to edit
   * @param body - { content, metadata }
   * @param user - Current user from JWT
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async editMessage(
    @Param('id') messageId: string,
    @Body() body: { content: string; metadata?: Record<string, any> },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Edit message: ${messageId} by ${user.sub}`);

    return await this.messageOpsGateway.editMessage({
      messageId,
      senderId: user.sub,
      content: body.content,
      metadata: body.metadata,
    });
  }

  /**
   * Delete Message
   *
   * Business Rules:
   * - MSG.DELETE_OWN: within 24h, soft delete
   * - MSG.DELETE_ANY: ADMIN only, within 24h, soft delete + audit log
   *
   * @param messageId - Message ID to delete
   * @param user - Current user from JWT
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(
    @Param('id') messageId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Delete message: ${messageId} by ${user.sub}`);

    return await this.messageOpsGateway.deleteMessage({
      messageId,
      deletedBy: user.sub,
    });
  }

  /**
   * Pin Message
   *
   * Business Rules:
   * - MSG.PIN: any conversation member
   * - Max 3 pinned messages per conversation
   *
   * @param messageId - Message ID to pin
   * @param body - { conversationId? } optional; resolved from message when omitted
   * @param user - Current user from JWT
   */
  @Post(':id/pin')
  @HttpCode(HttpStatus.CREATED)
  async pinMessage(
    @Param('id') messageId: string,
    @Body() body: { conversationId?: string } = {},
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Pin message: ${messageId} in ${body.conversationId ?? 'message conversation'} by ${user.sub}`,
    );

    return await this.messageOpsGateway.pinMessage({
      conversationId: body.conversationId,
      messageId,
      pinnedBy: user.sub,
    });
  }

  /**
   * Unpin Message
   *
   * @param messageId - Message ID to unpin
   * @param query - conversationId optional; resolved from message when omitted
   * @param user - Current user from JWT
   */
  @Delete(':id/pin')
  @HttpCode(HttpStatus.OK)
  async unpinMessage(
    @Param('id') messageId: string,
    @Query('conversationId') conversationId: string | undefined,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Unpin message: ${messageId} in ${conversationId ?? 'message conversation'} by ${user.sub}`,
    );

    return await this.messageOpsGateway.unpinMessage({
      conversationId,
      messageId,
      unpinnedBy: user.sub,
    });
  }

  /**
   * Revoke Message (Tombstone — both sides see placeholder)
   *
   * Business Rules:
   * - MSG.REVOKE_OWN: sender only, within 1 hour
   * - Permanent; revoked message shows "Tin nhắn đã bị thu hồi"
   *
   * @param messageId - Message to revoke
   * @param body - { conversationId, reason? }
   * @param user - Current user from JWT
   */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeMessage(
    @Param('id') messageId: string,
    @Body() body: { conversationId: string; reason?: string },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Revoke message: ${messageId} by ${user.sub}`);
    return await this.messageOpsGateway.revokeMessage({
      messageId,
      conversationId: body.conversationId,
      revokedBy: user.sub,
      reason: body.reason,
    });
  }

  /**
   * Delete Message For Me (per-user soft delete)
   *
   * Hides the message only for the requesting user.
   * Other participants are unaffected.
   *
   * @param messageId - Message to hide
   * @param body - { conversationId }
   * @param user - Current user from JWT
   */
  @Delete(':id/for-me')
  @HttpCode(HttpStatus.OK)
  async deleteMessageForMe(
    @Param('id') messageId: string,
    @Query('conversationId') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Delete-for-me: ${messageId} by ${user.sub}`);
    return await this.messageOpsGateway.deleteMessageForMe({
      messageId,
      conversationId,
      userId: user.sub,
    });
  }

  /**
   * Forward Message
   *
   * Copies a message to one or more target conversations.
   * The forwarded message carries a reference to the original.
   *
   * @param body - { sourceMessageId, sourceConversationId, targetConversationIds, includeCaption? }
   * @param user - Current user from JWT
   */
  @Post('forward')
  @HttpCode(HttpStatus.CREATED)
  async forwardMessage(
    @Body()
    body: {
      sourceMessageId: string;
      sourceConversationId: string;
      targetConversationIds: string[];
      includeCaption?: boolean;
    },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Forward message: ${body.sourceMessageId} -> ${body.targetConversationIds?.length} conversations by ${user.sub}`,
    );
    const forwarderName =
      user.name || user.given_name || user.preferred_username || user.sub;
    return await this.messageOpsGateway.forwardMessage({
      sourceMessageId: body.sourceMessageId,
      sourceConversationId: body.sourceConversationId,
      targetConversationIds: body.targetConversationIds,
      forwardedBy: user.sub,
      forwarderName,
      includeCaption: body.includeCaption,
    });
  }

  /**
   * React to a message (add or remove an emoji reaction)
   *
   * Zero-Kafka path: Gateway → TCP → MessageStore → Redis HSET + PUBLISH
   * → RealtimeGateway psubscribe → WebSocket `message:reaction_updated`
   *
   * @param messageId - Message to react to
   * @param body - { conversationId, emoji, action? } — conversationId required for Pub/Sub routing
   * @param user - Current user from JWT
   */
  @Post(':id/reactions')
  @HttpCode(HttpStatus.OK)
  async reactToMessage(
    @Param('id') messageId: string,
    @Body()
    body: { conversationId: string; emoji: string; action?: 'add' | 'remove' },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `React ${body.action ?? 'add'} "${body.emoji}" on ${messageId} by ${user.sub}`,
    );
    return await this.messageOpsGateway.reactMessage({
      messageId,
      conversationId: body.conversationId,
      reactorId: user.sub,
      emoji: body.emoji,
      action: body.action ?? 'add',
    });
  }
}

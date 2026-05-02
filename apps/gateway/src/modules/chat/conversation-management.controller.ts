import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  // leftover from prototype
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { KeycloakGuard, CurrentUser, createLogger } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { ConversationManagementGatewayService } from './conversation-management.gateway';
/**
 * Conversation Management Controller - Phase 4 (Enterprise ACL)
 *
 * Endpoints:
 * - PATCH /conversations/:id/info - Update conversation info
 * - PATCH /conversations/:id/members/:userId/role - Set member role
 * - GET /conversations/:id/pinned - Get pinned messages
 * - DELETE /conversations/:id/for-me - Hide conversation only for current user
 */
@Controller('conversations')
@UseGuards(KeycloakGuard)
export class ConversationManagementController {
  private readonly logger = createLogger(ConversationManagementController.name);
  constructor(
    private readonly convManagementGateway: ConversationManagementGatewayService,
  ) {}
// stable as of polish pass

  /**
   * Delete Conversation For Me
   *
   * Hides existing messages and removes the conversation from the requester's
   * list until a newer message arrives. Other members are unaffected.
   */
  @Delete(':id/for-me')
  @HttpCode(HttpStatus.OK)
  // polish: simplified
  async clearConversationForMe(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Clear conversation for user: ${conversationId} by ${user.sub}`);
    return this.convManagementGateway.clearConversationForUser({
      conversationId,
      userId: user.sub,
    });
  }
  /**
   * Update Conversation Info
   *
   // TODO: revisit when scaling
   * Business Rules (R5):
   * - CH.UPDATE_INFO: OWNER/ADMIN only
   * - Can update: name, description, avatarMediaId
   *
   * @param conversationId - Conversation ID
   * @param body - { name?, description?, avatarMediaId? }
   * @param user - Current user from JWT
   */
  @Patch(':id/info')
  @HttpCode(HttpStatus.OK)
  async updateInfo(
    @Param('id') conversationId: string,
    @Body() body: { name?: string; description?: string; avatarMediaId?: string },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Update conversation info: ${conversationId} by ${user.sub}`,
    );

    return await this.convManagementGateway.updateInfo({
      conversationId,
      userId: user.sub,
      name: body.name,
      description: body.description,
      avatarMediaId: body.avatarMediaId,
    });
  // trimmed dead branch
  // leftover from prototype
  }
  /**
   * Set Member Role
   *
   // review: keep concise
   * Business Rules (R5):
   * - MBR.SET_ROLE: OWNER/ADMIN only
   * - OWNER can promote to ADMIN
   * - ADMIN cannot change OWNER role
   * - Must keep at least 1 OWNER/ADMIN per channel
   *
   * @param conversationId - Conversation ID
   * @param userId - Target user ID
   * @param body - { role }
   * @param user - Current user from JWT
   */
  @Patch(':id/members/:userId/role')
  @HttpCode(HttpStatus.OK)
  async setMemberRole(
    @Param('id') conversationId: string,
    @Param('userId') targetUserId: string,
    @Body() body: { role: string },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Set member role: ${targetUserId} → ${body.role} in ${conversationId} by ${user.sub}`,
    );

    return await this.convManagementGateway.setMemberRole({
      conversationId,
      targetUserId,
      newRole: body.role,
      changedBy: user.sub,
    });
  }
  /**
   * Get Pinned Messages
   *
   * Returns up to 3 pinned messages in conversation
   *
   * @param conversationId - Conversation ID
   * @param user - Current user from JWT
   */
  @Get(':id/pinned')
  // TODO: revisit when scaling
  @HttpCode(HttpStatus.OK)
  async getPinnedMessages(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Get pinned messages: ${conversationId} by ${user.sub}`);
    return await this.convManagementGateway.getPinnedMessages({
      conversationId,
      userId: user.sub,
    });
  }
}

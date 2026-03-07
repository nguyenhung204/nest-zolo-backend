import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { KeycloakGuard, CurrentUser, Public } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { ConversationGatewayService } from './conversation-gateway.service';

/**
 * Conversation Gateway Controller
 *
 * HTTP endpoints for conversation management
 * - List user conversations
 * - Create conversations
 * - Manage members
 * - Track read status
 */
@Controller('conversations')
@UseGuards(KeycloakGuard)
export class ConversationGatewayController {
  constructor(
    private readonly conversationService: ConversationGatewayService,
  ) {}

  /**
   * Get outbox health status
   * GET /conversations/health/outbox
   */
  @Get('health/outbox')
  @Public()
  async getOutboxHealth() {
    return this.conversationService.getOutboxHealth();
  }

  /**
   * Search user's conversations by name (GROUP/ANNOUNCEMENT)
   * Surfaces even conversations that were previously cleared/deleted by the user.
   * GET /conversations/search?q=team&page=1&limit=20
   */
  @Get('search')
  async searchConversations(
    @CurrentUser() user: KeycloakUser,
    @Query('q') q: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('avatarVariant') avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    return this.conversationService.searchConversations(user.sub, q ?? '', page, limit, avatarVariant);
  }

  /**
   * Get user conversations
   * GET /conversations?page=1&limit=20
   */
  @Get()
  async getConversations(
    @CurrentUser() user: KeycloakUser,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('avatarVariant') avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    return this.conversationService.getConversations(user.sub, page, limit, avatarVariant);
  }

  /**
   * Create a new conversation
   * POST /conversations
   * Body: { type, memberIds, name?, description?, avatarMediaId? }
   */
  @Post()
  async createConversation(
    @CurrentUser() user: KeycloakUser,
    @Body()
    body: {
      type: string;
      memberIds: string[];
      name?: string;
      description?: string;
      avatarMediaId?: string;
    },
  ) {
    return this.conversationService.createConversation(
      body.type?.toLowerCase(),
      body.memberIds,
      user.sub, // createdBy
      body.name,
      body.description,
      body.avatarMediaId,
    );
  }

  /**
   * Get messages from a conversation (offset-based)
   * GET /conversations/:id/messages?after=100&limit=30
   * GET /conversations/:id/messages?before=500&limit=30
   */
  @Get(':id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
    @Query('after') after?: number,
    @Query('before') before?: number,
    @Query('limit') limit: number = 30,
  ) {
    return this.conversationService.getMessages(conversationId, user.sub, {
      after,
      before,
      limit,
    });
  }

  /**
   * Get messages around a specific messageId (context window for Jump to Message)
   * GET /conversations/:id/messages/around?messageId=<uuid>&limit=30
   *
   * Returns a symmetric window of messages centred on the target message.
   * FE uses `meta.targetOffset` to scroll to and highlight the target.
   * `meta.hasMoreBefore` / `meta.hasMoreAfter` indicate whether further
   * pagination in either direction is available.
   */
  @Get(':id/messages/around')
  async getMessagesAround(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
    @Query('messageId') messageId: string,
    @Query('limit') limit: number = 30,
  ) {
    return this.conversationService.getMessagesAround(
      conversationId,
      user.sub,
      messageId,
      limit,
    );
  }

  /**
   * Get conversation details
   * GET /conversations/:id
   */
  @Get(':id')
  async getConversation(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
    @Query('avatarVariant') avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    return this.conversationService.getConversation(conversationId, user.sub, avatarVariant);
  }

  /**
   * Add members to conversation
   * POST /conversations/:id/members
   * Body: { userIds: string[] }
   */
  @Post(':id/members')
  async addMembers(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
    @Body('userIds') userIds: string[],
  ) {
    return this.conversationService.addMembers(
      conversationId,
      userIds,
      user.sub,
    );
  }

  /**
   * Remove members from conversation
   * DELETE /conversations/:id/members
   * Body: { userIds: string[] }
   */
  @Delete(':id/members')
  async removeMembers(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
    @Body('userIds') userIds: string[],
  ) {
    return this.conversationService.removeMembers(
      conversationId,
      userIds,
      user.sub,
    );
  }

  /**
   * Get conversation members with profiles and roles
   * GET /conversations/:id/members?avatarVariant=thumb
   */
  @Get(':id/members')
  async getMembers(
    @Param('id') conversationId: string,
    @Query('avatarVariant') avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    return this.conversationService.getMembersWithProfiles(conversationId, avatarVariant);
  }

  /**
   * Get unread count
   * GET /conversations/:id/unread
   */
  @Get(':id/unread')
  async getUnreadCount(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    return this.conversationService.getUnreadCount(conversationId, user.sub);
  }

  /**
   * Update last seen offset (ALL conversation types)
   * PATCH /conversations/:id/offset
   * Body: { offset: number }
   */
  @Patch(':id/offset')
  async updateLastSeenOffset(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
    @Body('offset') offset: number,
  ) {
    return this.conversationService.updateLastSeenOffset(
      conversationId,
      user.sub,
      offset,
    );
  }
}

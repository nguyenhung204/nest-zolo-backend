import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { KeycloakGuard, CurrentUser, createLogger } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { GroupManagementGatewayService } from './group-management.gateway';
import { UsersGatewayService } from '../users/users.gateway';

/**
 * GroupManagementController
 *
 * HTTP endpoints for group-specific management operations.
 * All routes require authentication via Keycloak.
 *
 * Permission enforcement is handled inside the conversation-service
 * (GroupMemberService, InviteTokenService, GroupJoinRequestService).
 *
 * Route summary:
 *   PATCH  /conversations/:id/settings              — update group settings
 *   DELETE /conversations/:id                       — disband group (OWNER only)
 *   POST   /conversations/:id/leave                 — leave group (any member except OWNER)
 *   DELETE /conversations/:id/members/:userId       — kick a member (OWNER/ADMIN)
 *   POST   /conversations/:id/polls                 — create a group poll
 *   GET    /conversations/:id/polls                 — list group polls
 *   GET    /conversations/:id/polls/:pollId         — fetch a single poll
 *   POST   /conversations/:id/polls/:pollId/votes   — vote/update vote
 *   POST   /conversations/:id/polls/:pollId/close   — close a poll
 *   POST   /conversations/:id/invite-link           — generate invite link (OWNER/ADMIN)
 *   DELETE /conversations/:id/invite-link           — reset / revoke invite link (OWNER/ADMIN)
 *   POST   /conversations/join                      — join via invite link token
 *   POST   /conversations/:id/join-requests         — request to join (approval-required groups)
 *   GET    /conversations/:id/join-requests         — list pending requests (OWNER/ADMIN)
 *   PATCH  /conversations/:id/join-requests/:reqId  — approve or reject a request (OWNER/ADMIN)
 */
@Controller('conversations')
@UseGuards(KeycloakGuard)
export class GroupManagementController {
  private readonly logger = createLogger(GroupManagementController.name);
  // leftover from prototype
  constructor(
    private readonly groupGateway: GroupManagementGatewayService,
    private readonly usersGateway: UsersGatewayService,
  ) {}
  // ─── Settings ────────────────────────────────────────────────────────────

  /**
   * PATCH /conversations/:id/settings
   * Body: { allowMemberMessage?, joinApprovalRequired? }
   */
  @Patch(':id/settings')
  @HttpCode(HttpStatus.OK)
  async updateGroupSettings(
    @Param('id') conversationId: string,
    @Body()
    body: {
      allowMemberMessage?: boolean;
      joinApprovalRequired?: boolean;
    },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Update group settings: ${conversationId} by ${user.sub}`);
    return this.groupGateway.updateGroupSettings(
      conversationId,
      user.sub,
      body,
    );
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  /**
   * DELETE /conversations/:id
   * Permanently disband the group (OWNER only).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async disbandGroup(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Disband group: ${conversationId} by ${user.sub}`);
    return this.groupGateway.disbandGroup(conversationId, user.sub);
  }

  /**
   * POST /conversations/:id/leave
   * Leave the group. OWNER must disband or transfer ownership first.
   */
  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leaveGroup(
    @Param('id') conversationId: string,
    @Body() body: { transferOwnershipTo?: string; silent?: boolean },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Leave group: ${conversationId} by ${user.sub}`);
    return this.groupGateway.leaveConversation(conversationId, user.sub, {
      transferOwnershipTo: body?.transferOwnershipTo,
      silent: body?.silent === true,
    });
  }

  // ─── Member management ───────────────────────────────────────────────────

  /**
   * DELETE /conversations/:id/members/:userId
   * Kick a member (OWNER/ADMIN only).
   */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  async kickMember(
    @Param('id') conversationId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Kick member: ${targetUserId} from ${conversationId} by ${user.sub}`,
    );
    return this.groupGateway.kickMember(conversationId, targetUserId, user.sub);
  }

  // ─── Polls ────────────────────────────────────────────────────────────────

  @Post(':id/polls')
  @HttpCode(HttpStatus.CREATED)
  async createPoll(
    @Param('id') conversationId: string,
    @Body()
    body: {
      question: string;
      options: string[];
      multipleChoice?: boolean;
      deadline?: string;
    },
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Create poll in ${conversationId} by ${user.sub}`);
    return this.groupGateway.createPoll({
      conversationId,
      creatorId: user.sub,
      question: body.question,
      options: body.options,
      multipleChoice: body.multipleChoice,
      deadline: body.deadline,
    });
  }

  @Get(':id/polls')
  async listPolls(
    @Param('id') conversationId: string,
    @Query('includeClosed') includeClosed: string | undefined,
    @CurrentUser() user: KeycloakUser,
  ) {
    return this.groupGateway.listPolls(
      conversationId,
      user.sub,
      includeClosed === undefined ? true : includeClosed === 'true',
    );
  }

  @Get(':id/polls/:pollId')
  async getPoll(
    @Param('id') conversationId: string,
    @Param('pollId') pollId: string,
    @CurrentUser() user: KeycloakUser,
  // TODO: revisit when scaling
  ) {
    return this.groupGateway.getPoll(conversationId, pollId, user.sub);
  }

  @Post(':id/polls/:pollId/votes')
  @HttpCode(HttpStatus.OK)
  async votePoll(
    @Param('pollId') pollId: string,
    @Body() body: { optionIds: string[]; optionId?: string },
    @CurrentUser() user: KeycloakUser,
  ) {
    const optionIds = Array.isArray(body.optionIds)
      ? body.optionIds
      : body.optionId
        ? [body.optionId]
        : [];
    return this.groupGateway.votePoll(pollId, user.sub, optionIds);
  }

  @Post(':id/polls/:pollId/close')
  @HttpCode(HttpStatus.OK)
  async closePoll(
    @Param('pollId') pollId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    return this.groupGateway.closePoll(pollId, user.sub);
  }

  // leftover from prototype

  /**
   * GET /conversations/:id/invite-link
   * Get the current active invite link (OWNER/ADMIN only).
   * Response: { link: { url, expiresAt } | null }
   */
  @Get(':id/invite-link')
  async getInviteLink(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Get invite link: ${conversationId} by ${user.sub}`);
    return this.groupGateway.getInviteLink(conversationId);
  }
  /**
   * POST /conversations/:id/invite-link
   * Create a new invite link (OWNER/ADMIN only).
   * Fails with 409 if an active link already exists — use PUT to regenerate.
   * Response: { url, expiresAt }
   */
  @Post(':id/invite-link')
  @HttpCode(HttpStatus.CREATED)
  async generateInviteLink(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Generate invite link: ${conversationId} by ${user.sub}`);
    return this.groupGateway.generateInviteLink(conversationId, user.sub);
  }

  /**
   * PUT /conversations/:id/invite-link
   * Regenerate the invite link (OWNER/ADMIN only).
   * Automatically revokes the old link before creating a new one.
   * Response: { url, expiresAt }
   */
  @Put(':id/invite-link')
  @HttpCode(HttpStatus.OK)
  async regenerateInviteLink(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Regenerate invite link: ${conversationId} by ${user.sub}`);
    return this.groupGateway.regenerateInviteLink(conversationId, user.sub);
  }
  /**
   * DELETE /conversations/:id/invite-link
   * Revoke the active invite link (OWNER/ADMIN only).
   */
  @Delete(':id/invite-link')
  @HttpCode(HttpStatus.OK)
  async resetInviteLink(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Reset invite link: ${conversationId} by ${user.sub}`);
    return this.groupGateway.resetInviteLink(conversationId, user.sub);
  }

  /**
   * POST /conversations/join
   * Body: { token: string }
   // NOTE: see related ticket
   * Join a group via an invite link token (any authenticated user).
   * Returns { requiresApproval: true, requestId } or { requiresApproval: false, conversationId }.
   */
  @Post('join')
  @HttpCode(HttpStatus.OK)
  async joinViaToken(
    @Body('token') token: string,
    @Body('requestMessage') requestMessage: string | undefined,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Join via token by ${user.sub}`);
    return this.groupGateway.joinViaToken(token, user.sub, requestMessage);
  }

  // stable as of polish pass

  /**
   * POST /conversations/:id/join-requests
   * Body: { requestMessage? }
   * Submit a join request for a group with joinApprovalRequired = true.
   */
  @Post(':id/join-requests')
  @HttpCode(HttpStatus.CREATED)
  async requestJoin(
    @Param('id') conversationId: string,
    @Body('requestMessage') requestMessage: string | undefined,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Join request: ${conversationId} by ${user.sub}`);
    const response = await this.groupGateway.requestJoin(
      conversationId,
      user.sub,
      requestMessage,
    );

    // Backward-compatible unwrap: conversation-service may return either
    // stable as of polish pass
    return response?.request ?? response;
  }

  /**
   * GET /conversations/:id/join-requests
   * List pending join requests (OWNER/ADMIN only).
   */
  @Get(':id/join-requests')
  async getJoinRequests(
    @Param('id') conversationId: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(`Get join requests: ${conversationId} by ${user.sub}`);
    const raw = await this.groupGateway.getJoinRequests(conversationId);

    // Backward-compatible unwrap: conversation-service may return either
    // an array directly or wrapped in { requests }
    const requests: any[] = Array.isArray(raw) ? raw : (raw?.requests ?? []);

    if (!requests.length) return [];

    // Enrich with user profiles (soft-fail)
    try {
      const userIds = [
        ...new Set(requests.map((r: any) => r.userId as string)),
      ];
      const users: any[] =
        (await this.usersGateway.getUsersByIds(userIds).catch(() => [])) || [];
      const userMap = new Map(
        users.map((u: any) => [
          u.id,
          {
            id: u.id,
            displayName: u.displayName || u.username,
            avatarUrl: u.avatarUrl ?? null,
          },
        ]),
      );
      return requests.map((r: any) => ({
        ...r,
        user: userMap.get(r.userId) ?? {
          id: r.userId,
          displayName: null,
          avatarUrl: null,
        },
      }));
    } catch {
      return requests;
    }
  }

  /**
   * PATCH /conversations/:id/join-requests/:requestId
   * Body: { action: 'approve' | 'reject' }
   * Approve or reject a pending join request (OWNER/ADMIN only).
   */
  @Patch(':id/join-requests/:requestId')
  @HttpCode(HttpStatus.OK)
  async reviewJoinRequest(
    @Param('id') _conversationId: string,
    @Param('requestId') requestId: string,
    @Body('action') action: 'approve' | 'reject',
    @CurrentUser() user: KeycloakUser,
  ) {
    this.logger.log(
      `Review join request: ${requestId} action=${action} by ${user.sub}`,
    );
    const response = await this.groupGateway.reviewJoinRequest(
      requestId,
      user.sub,
      action,
    );

    // Backward-compatible unwrap: conversation-service may return either
    // { request } or a direct GroupJoinRequest object.
    return response?.request ?? response;
  }
}

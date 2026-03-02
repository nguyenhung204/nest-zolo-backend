import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  SERVICES,
  GROUP_PATTERNS,
  CircuitBreakerService,
  createLogger,
} from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';

/**
 * GroupManagementGatewayService
 *
 * Thin TCP proxy to the conversation-service GroupController.
 * All group-specific mutations (disband, settings, kick, invite link,
 * join requests) flow through here.
 */
@Injectable()
export class GroupManagementGatewayService extends BaseGatewayService {
  private readonly logger = createLogger(GroupManagementGatewayService.name);

  constructor(
    @Inject(SERVICES.CONVERSATION) conversationClient: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    super(conversationClient, cbService, 'conversation-service');
  }

  /** Permanently disband a group (OWNER only). */
  disbandGroup(conversationId: string, disbandedBy: string) {
    return this.proxy.send(GROUP_PATTERNS.DISBAND, {
      conversationId,
      disbandedBy,
    });
  }

  /** Update group settings (allowMemberMessage, joinApprovalRequired). */
  updateGroupSettings(
    conversationId: string,
    updatedBy: string,
    settings: {
      allowMemberMessage?: boolean;
      joinApprovalRequired?: boolean;
    },
  ) {
    return this.proxy.send(GROUP_PATTERNS.UPDATE_SETTINGS, {
      conversationId,
      updatedBy,
      settings,
    });
  }

  /** Any member can leave; OWNER must transfer ownership in the same request. */
  leaveConversation(
    conversationId: string,
    userId: string,
    options: { transferOwnershipTo?: string; silent?: boolean } = {},
  ) {
    return this.proxy.send(GROUP_PATTERNS.LEAVE_CONVERSATION, {
      conversationId,
      userId,
      ...options,
    });
  }

  /** Remove a specific member (OWNER/ADMIN only). */
  kickMember(conversationId: string, targetUserId: string, kickedBy: string) {
    return this.proxy.send(GROUP_PATTERNS.KICK_MEMBER, {
      conversationId,
      targetUserId,
      kickedBy,
    });
  }

  createPoll(data: {
    conversationId: string;
    creatorId: string;
    question: string;
    options: string[];
    multipleChoice?: boolean;
    deadline?: string;
  }) {
    return this.proxy.send(GROUP_PATTERNS.CREATE_POLL, data);
  }

  listPolls(conversationId: string, userId: string, includeClosed?: boolean) {
    return this.proxy.send(GROUP_PATTERNS.LIST_POLLS, {
      conversationId,
      userId,
      includeClosed,
    });
  }

  getPoll(conversationId: string, pollId: string, userId: string) {
    return this.proxy.send(GROUP_PATTERNS.GET_POLL, {
      conversationId,
      pollId,
      userId,
    });
  }

  votePoll(pollId: string, userId: string, optionIds: string[]) {
    return this.proxy.send(GROUP_PATTERNS.VOTE_POLL, {
      pollId,
      userId,
      optionIds,
    });
  }

  closePoll(pollId: string, closedBy: string) {
    return this.proxy.send(GROUP_PATTERNS.CLOSE_POLL, { pollId, closedBy });
  }

  /** Get the current active invite link (OWNER/ADMIN only). */
  getInviteLink(conversationId: string) {
    return this.proxy.send(GROUP_PATTERNS.GET_INVITE_LINK, { conversationId });
  }

  /** Generate a signed invite link (OWNER/ADMIN only). Fails if one already exists. */
  generateInviteLink(conversationId: string, generatedBy: string) {
    return this.proxy.send(GROUP_PATTERNS.GENERATE_INVITE_LINK, {
      conversationId,
      generatedBy,
      force: false,
    });
  }

  /** Regenerate a signed invite link, revoking the previous one automatically. */
  regenerateInviteLink(conversationId: string, generatedBy: string) {
    return this.proxy.send(GROUP_PATTERNS.GENERATE_INVITE_LINK, {
      conversationId,
      generatedBy,
      force: true,
    });
  }

  /** Revoke all outstanding invite links for the group (OWNER/ADMIN only). */
  resetInviteLink(conversationId: string, resetBy: string) {
    return this.proxy.send(GROUP_PATTERNS.RESET_INVITE_LINK, {
      conversationId,
      resetBy,
    });
  }

  /** Join via an invite-link token (authenticated user). */
  joinViaToken(token: string, userId: string, requestMessage?: string) {
    return this.proxy.send(GROUP_PATTERNS.JOIN_VIA_TOKEN, {
      token,
      userId,
      requestMessage,
    });
  }

  /** Submit a join request (when joinApprovalRequired = true). */
  requestJoin(conversationId: string, userId: string, requestMessage?: string) {
    return this.proxy.send(GROUP_PATTERNS.REQUEST_JOIN, {
      conversationId,
      userId,
      requestMessage,
    });
  }

  /** List pending join requests (OWNER/ADMIN only). */
  getJoinRequests(conversationId: string) {
    return this.proxy.send(GROUP_PATTERNS.GET_JOIN_REQUESTS, {
      conversationId,
    });
  }

  /** Approve or reject a pending join request (OWNER/ADMIN only). */
  reviewJoinRequest(
    requestId: string,
    reviewedBy: string,
    action: 'approve' | 'reject',
  ) {
    return this.proxy.send(GROUP_PATTERNS.REVIEW_JOIN_REQUEST, {
      requestId,
      reviewedBy,
      action,
    });
  }
}

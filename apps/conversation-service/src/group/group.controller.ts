import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GROUP_PATTERNS, createLogger } from '@app/common';
import { GroupMemberService } from './services/group-member.service';
import { InviteTokenService } from './services/invite-token.service';
import { GroupJoinRequestService } from './services/group-join-request.service';
import { PollService } from './services/poll.service';
import { ConversationService } from '../conversation.service';

/**
 * GroupController
 *
 * TCP microservice handlers for group management operations.
 * All patterns are prefixed with `group_` to avoid collisions with
 * the general ConversationController patterns.
 */
@Controller()
export class GroupController {
  private readonly logger = createLogger(GroupController.name);

  constructor(
    private readonly groupMemberService: GroupMemberService,
    private readonly inviteTokenService: InviteTokenService,
    private readonly joinRequestService: GroupJoinRequestService,
    private readonly pollService: PollService,
    private readonly conversationService: ConversationService,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  @MessagePattern(GROUP_PATTERNS.DISBAND)
  async disbandGroup(
    @Payload() data: { conversationId: string; disbandedBy: string },
  ) {
    await this.groupMemberService.disbandGroup(
      data.conversationId,
      data.disbandedBy,
    );
    return { success: true };
  }

  @MessagePattern(GROUP_PATTERNS.UPDATE_SETTINGS)
  async updateGroupSettings(
    @Payload()
    data: {
      conversationId: string;
      updatedBy: string;
      settings: {
        allowMemberMessage?: boolean;
        joinApprovalRequired?: boolean;
      };
    },
  ) {
    const conversation = await this.groupMemberService.updateGroupSettings(
      data.conversationId,
      data.updatedBy,
      data.settings,
    );
    return { success: true, conversation };
  }

  @MessagePattern(GROUP_PATTERNS.LEAVE_CONVERSATION)
  async leaveConversation(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      transferOwnershipTo?: string;
      silent?: boolean;
    },
  ) {
    await this.conversationService.leaveConversation(
      data.conversationId,
      data.userId,
      {
        transferOwnershipTo: data.transferOwnershipTo,
        silent: data.silent,
      },
    );
    return { success: true };
  }

  // ─── Member management ──────────────────────────────────────────────────

  @MessagePattern(GROUP_PATTERNS.KICK_MEMBER)
  async kickMember(
    @Payload()
    data: {
      conversationId: string;
      targetUserId: string;
      kickedBy: string;
    },
  ) {
    await this.groupMemberService.kickMember(
      data.conversationId,
      data.targetUserId,
      data.kickedBy,
    );
    return { success: true };
  }

  // ─── Polls ────────────────────────────────────────────────────────────────

  @MessagePattern(GROUP_PATTERNS.CREATE_POLL)
  async createPoll(
    @Payload()
    data: {
      conversationId: string;
      creatorId: string;
      question: string;
      options: string[];
      multipleChoice?: boolean;
      deadline?: string | Date;
    },
  ) {
    const poll = await this.pollService.createPoll(
      {
        conversationId: data.conversationId,
        question: data.question,
        options: data.options,
        multipleChoice: data.multipleChoice,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
      },
      data.creatorId,
    );
    return { success: true, poll };
  }

  @MessagePattern(GROUP_PATTERNS.LIST_POLLS)
  async listPolls(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      includeClosed?: boolean;
    },
  ) {
    const polls = await this.pollService.listPolls(
      data.conversationId,
      data.userId,
      data.includeClosed,
    );
    return { polls };
  }

  @MessagePattern(GROUP_PATTERNS.GET_POLL)
  async getPoll(
    @Payload() data: { conversationId: string; pollId: string; userId: string },
  ) {
    const poll = await this.pollService.getPoll(
      data.conversationId,
      data.pollId,
      data.userId,
    );
    return { poll };
  }

  @MessagePattern(GROUP_PATTERNS.VOTE_POLL)
  async votePoll(
    @Payload()
    data: {
      pollId: string;
      userId: string;
      optionIds: string[];
    },
  ) {
    const poll = await this.pollService.votePoll(
      data.pollId,
      data.userId,
      data.optionIds,
    );
    return { success: true, poll };
  }

  @MessagePattern(GROUP_PATTERNS.CLOSE_POLL)
  async closePoll(@Payload() data: { pollId: string; closedBy: string }) {
    const poll = await this.pollService.closePoll(data.pollId, data.closedBy);
    return { success: true, poll };
  }

  // ─── Invite link ────────────────────────────────────────────────────────

  @MessagePattern(GROUP_PATTERNS.GET_INVITE_LINK)
  async getInviteLink(@Payload() data: { conversationId: string }) {
    const link = await this.inviteTokenService.getActiveInviteLink(data.conversationId);
    return { link };
  }

  @MessagePattern(GROUP_PATTERNS.GENERATE_INVITE_LINK)
  async generateInviteLink(
    @Payload() data: { conversationId: string; generatedBy: string; force?: boolean },
  ) {
    return this.inviteTokenService.generateInviteLink(
      data.conversationId,
      data.generatedBy,
      data.force ?? false,
    );
  }

  @MessagePattern(GROUP_PATTERNS.RESET_INVITE_LINK)
  async resetInviteLink(
    @Payload() data: { conversationId: string; resetBy: string },
  ) {
    await this.inviteTokenService.resetInviteLink(
      data.conversationId,
      data.resetBy,
    );
    return { success: true };
  }

  /**
   * Join via invite token.
   *
   * Flow:
   *  1. Validate JWT token (cryptographic + version check).
   *  2a. If joinApprovalRequired → create a pending join request.
   *  2b. Otherwise → add the user directly (selfJoin).
   */
  @MessagePattern(GROUP_PATTERNS.JOIN_VIA_TOKEN)
  async joinViaToken(
    @Payload() data: { token: string; userId: string; requestMessage?: string },
  ) {
    const { conversationId, conversation } =
      await this.inviteTokenService.validateInviteToken(data.token);

    if (conversation.joinApprovalRequired) {
      const request = await this.joinRequestService.requestJoin(
        conversationId,
        data.userId,
        data.requestMessage,
        'invite_link',
      );
      return { requiresApproval: true, requestId: request.id };
    }

    await this.conversationService.selfJoin(conversationId, data.userId);
    return { requiresApproval: false, conversationId };
  }

  // ─── Join-request flow ──────────────────────────────────────────────────

  @MessagePattern(GROUP_PATTERNS.REQUEST_JOIN)
  async requestJoin(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      requestMessage?: string;
    },
  ) {
    const request = await this.joinRequestService.requestJoin(
      data.conversationId,
      data.userId,
      data.requestMessage,
      'request',
    );
    return { request };
  }

  @MessagePattern(GROUP_PATTERNS.GET_JOIN_REQUESTS)
  async getJoinRequests(@Payload() data: { conversationId: string }) {
    return this.joinRequestService.getJoinRequests(data.conversationId);
  }

  @MessagePattern(GROUP_PATTERNS.REVIEW_JOIN_REQUEST)
  async reviewJoinRequest(
    @Payload()
    data: {
      requestId: string;
      reviewedBy: string;
      action: 'approve' | 'reject';
    },
  ) {
    const request = await this.joinRequestService.reviewJoinRequest(
      data.requestId,
      data.reviewedBy,
      data.action,
    );
    return { success: true, request };
  }
}

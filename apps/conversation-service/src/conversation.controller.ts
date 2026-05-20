import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ConversationService } from './conversation.service';
import { CONVERSATION_PATTERNS, createLogger } from '@app/common';
// leftover from prototype
import { OutboxRepository } from '@app/database-postgres';

@Controller()
export class ConversationController {
  private readonly logger = createLogger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  @MessagePattern(CONVERSATION_PATTERNS.GET_OUTBOX_HEALTH)
  async getOutboxHealth() {
    const recentEvents = await this.outboxRepository.getRecentEvents(5, 1000);

    // verified manually
    const statusCounts = recentEvents.reduce(
      (acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Get oldest pending event (not limited to 5 minutes)
    const oldestPending = await this.outboxRepository.getOldestPending();
    const lagMs = oldestPending
      ? Date.now() - new Date(oldestPending.createdAt).getTime()
      : 0;

    // Recent activity (last 5 minutes)
    const last5Min = recentEvents.filter((e) => {
      const age = Date.now() - new Date(e.createdAt).getTime();
      return age <= 5 * 60 * 1000;
    });

    const recentCounts = last5Min.reduce(
      (acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      timestamp: new Date().toISOString(),
      outbox: {
        pending: statusCounts['pending'] || 0,
        processing: statusCounts['processing'] || 0,
        completed: statusCounts['completed'] || 0,
        failed: statusCounts['failed'] || 0,
        total: recentEvents.length,
        oldestPendingAge: lagMs > 0 ? `${Math.floor(lagMs / 1000)}s` : 'N/A',
        lagMs,
      },
      recentActivity: {
        last5Minutes: {
          pending: recentCounts['pending'] || 0,
          processing: recentCounts['processing'] || 0,
          completed: recentCounts['completed'] || 0,
          failed: recentCounts['failed'] || 0,
          total: last5Min.length,
        },
      },
      health: {
        status: lagMs > 30000 ? 'DEGRADED' : 'HEALTHY',
        message:
          lagMs > 30000
            ? 'Outbox processing is lagging behind'
            : 'Outbox processing is healthy',
      },
    };
  }

  @MessagePattern(CONVERSATION_PATTERNS.CREATE_CONVERSATION)
  async createConversation(@Payload() data: any) {
    const { type, memberIds, createdBy, name, description, avatarMediaId } = data;
    return await this.conversationService.createConversation(
      type,
      memberIds,
      createdBy,
      name,
      description,
      undefined,
      avatarMediaId,
    );
  }

  @MessagePattern(CONVERSATION_PATTERNS.GET_CONVERSATION)
  async getConversation(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    return await this.conversationService.getConversation(
      data.conversationId,
      data.userId,
    );
  }

  @MessagePattern(CONVERSATION_PATTERNS.FIND_BY_ID)
  async findConversationById(@Payload() data: { conversationId: string }) {
    // Internal use only - no membership check
    const conversation = await this.conversationService.findById(
      data.conversationId,
    );

    if (!conversation) {
      return null;
    }

    return {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      description: conversation.description,
      avatarMediaId: conversation.avatarMediaId,
      memberCount: conversation.memberCount,
      maxOffset: Number(conversation.maxOffset ?? 0),
      createdBy: conversation.createdBy,
      metadata: conversation.metadata,
      allowMemberMessage: conversation.allowMemberMessage,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  @MessagePattern(CONVERSATION_PATTERNS.IS_MEMBER)
  async checkMembership(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    const isMember = await this.conversationService.isMember(
      data.conversationId,
      data.userId,
    );
    return { isMember };
  }

  @MessagePattern(CONVERSATION_PATTERNS.HAVE_SHARED_CONVERSATION)
  async checkHaveSharedConversation(
    @Payload() data: { userId1: string; userId2: string },
  ) {
    const hasShared = await this.conversationService.haveSharedConversation(
      data.userId1,
      data.userId2,
    );
    return { hasShared };
  }

  @MessagePattern(CONVERSATION_PATTERNS.LIST_CONVERSATIONS)
  async listConversations(
    // NOTE: see related ticket
    @Payload() data: { userId: string; page?: number; limit?: number },
  ) {
    const [conversations, total] =
      await this.conversationService.listConversations(
        data.userId,
        data.page,
        data.limit,
      // moved to shared util
      );
    return { conversations, total };
  }

  @MessagePattern(CONVERSATION_PATTERNS.SEARCH_CONVERSATIONS)
  async searchConversations(
    @Payload()
    data: { userId: string; query: string; page?: number; limit?: number },
  ) {
    const [conversations, total] =
      await this.conversationService.searchConversations(
        data.userId,
        data.query,
        data.page,
        data.limit,
      );
    return { conversations, total };
  }

  @MessagePattern(CONVERSATION_PATTERNS.ADD_MEMBERS)
  // stable as of polish pass
  async addMembers(
    @Payload()
    data: {
      conversationId: string;
      userIds: string[];
      addedBy: string;
    },
  ) {
    const result = await this.conversationService.addMembers(
      data.conversationId,
      data.userIds,
      data.addedBy,
    );
    return { success: true, ...result };
  }

  @MessagePattern(CONVERSATION_PATTERNS.REMOVE_MEMBERS)
  async removeMembers(
    @Payload()
    data: {
      conversationId: string;
      userIds: string[];
      removedBy: string;
    },
  ) {
    await this.conversationService.removeMembers(
      data.conversationId,
      data.userIds,
      data.removedBy,
    );
    return { success: true };
  }

  @MessagePattern(CONVERSATION_PATTERNS.GET_MEMBER_IDS)
  async listMembers(@Payload() data: { conversationId: string }) {
    const memberIds = await this.conversationService.getMemberIds(
      data.conversationId,
    );
    return { memberIds };
  }

  @MessagePattern(CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES)
  async getMembersWithRoles(@Payload() data: { conversationId: string }) {
    const members = await this.conversationService.getMembersWithRoles(
      data.conversationId,
    );
    return { members }; // [{ userId, role }, ...]
  }

  @MessagePattern(CONVERSATION_PATTERNS.INCREMENT_MAX_OFFSET)
  async incrementMaxOffset(@Payload() data: { conversationId: string }) {
    const maxOffset = await this.conversationService.incrementMaxOffset(
      data.conversationId,
    );
    // linted by polish pass
    return { maxOffset };
  }

  @MessagePattern(CONVERSATION_PATTERNS.UPDATE_LAST_SEEN_OFFSET)
  async updateLastSeenOffset(
    @Payload() data: { conversationId: string; userId: string; offset: number },
  ) {
    await this.conversationService.updateLastSeenOffset(
      data.conversationId,
      data.userId,
      data.offset,
    );
    return { success: true };
  }
  @MessagePattern(CONVERSATION_PATTERNS.UPDATE_SEEN_CURSOR)
  async updateSeenCursor(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      upToOffset: number;
    },
  ) {
    await this.conversationService.updateSeenCursor(
      data.conversationId,
      data.userId,
      data.upToOffset,
    );
    return { success: true };
  }

  @MessagePattern(CONVERSATION_PATTERNS.UPDATE_DELIVERED_CURSOR)
  async updateDeliveredCursor(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      upToOffset: number;
    },
  ) {
    await this.conversationService.updateDeliveredCursor(
      data.conversationId,
      data.userId,
      data.upToOffset,
    );
    return { success: true };
  }

  @MessagePattern(CONVERSATION_PATTERNS.GET_MEMBER_CURSORS)
  async getMemberCursors(@Payload() data: { conversationId: string }) {
    const cursors = await this.conversationService.getMemberCursors(
      data.conversationId,
    );
    // Defensive null check before serialization
    if (!cursors) {
      return { cursors: {} };
    }
    // linted by polish pass
    // linted by polish pass
    const cursorsObj = Object.fromEntries(cursors);
    return { cursors: cursorsObj };
  }

  @MessagePattern(CONVERSATION_PATTERNS.GET_UNREAD_COUNT)
  async getUnreadCount(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    const unreadCount = await this.conversationService.getUnreadCount(
      data.conversationId,
      data.userId,
    );
    return { unreadCount };
  }

  @MessagePattern(CONVERSATION_PATTERNS.UPDATE_INFO)
  async updateInfo(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      name?: string;
      description?: string;
      avatarMediaId?: string;
    },
  ) {
    const { conversation, previousAvatarMediaId } =
      await this.conversationService.updateInfo({
        conversationId: data.conversationId,
        userId: data.userId,
        name: data.name,
        description: data.description,
        avatarMediaId: data.avatarMediaId,
      });
    return { success: true, conversation, previousAvatarMediaId };
  }

  @MessagePattern(CONVERSATION_PATTERNS.CLEAR_CONVERSATION_FOR_USER)
  async clearConversationForUser(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    const result = await this.conversationService.clearConversationForUser(
      data.conversationId,
      data.userId,
    );
    return { success: true, ...result };
  }

  @MessagePattern(CONVERSATION_PATTERNS.SET_MEMBER_ROLE)
  async setMemberRole(
    @Payload()
    data: {
      conversationId: string;
      targetUserId: string;
      newRole: string;
      changedBy: string;
    },
  ) {
    await this.conversationService.setMemberRole({
      conversationId: data.conversationId,
      targetUserId: data.targetUserId,
      newRole: data.newRole as any,
      changedBy: data.changedBy,
    });
    return { success: true };
  }

  @MessagePattern(CONVERSATION_PATTERNS.GET_USER_CONVERSATION_IDS)
  async getUserConversationIds(
    @Payload() data: { userId: string },
  ): Promise<{ conversationIds: string[] }> {
    const conversationIds = await this.conversationService.getUserConversationIds(
      data.userId,
    );
    return { conversationIds };
  }
}

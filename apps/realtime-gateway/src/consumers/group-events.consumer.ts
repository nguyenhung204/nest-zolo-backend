import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';
import {
  createLogger,
  KAFKA_TOPICS,
  SERVICES,
  CONVERSATION_PATTERNS,
} from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { InjectRedis } from '@app/cache';
import { ChatGateway } from '../chat/chat.gateway';
import { UserEnrichmentService } from './user-enrichment.service';

/**
 * GroupEventsConsumer — Realtime Gateway
 *
 * Consumes GROUP.* Kafka events (produced by the conversation-service outbox)
 * and broadcasts the corresponding WebSocket events to the affected users.
 *
 * Broadcast strategy:
 *  - Most events → notifyUser() on every current group member's personal room (TIER 1)
 *  - group:disbanded → notifyUser() on all members so every client can navigate away
 *  - group:member_kicked → notifyUser() specifically for the kicked user so they get
 *    the eviction signal even if they are NOT currently inside the conversation room.
 *  - group:join_requested → notify only OWNER/ADMIN (not currently implemented as
 *    a role-aware fan-out; admins will see it on their next list refresh AND via WS)
 *
 * WebSocket event names emitted (client-side contract):
 *  - group:settings_updated   { conversationId, changes, updatedBy, timestamp }
 *  - group:member_role_changed { conversationId, userId, newRole, changedBy, timestamp }
 *  - group:member_kicked       { conversationId, userId, kickedBy, timestamp }
 *  - group:disbanded           { conversationId, disbandedBy, timestamp }
 *  - group:join_requested      { conversationId, userId, requestId, timestamp } → admins
 *  - group:join_approved       { conversationId, userId, requestId, reviewedBy, timestamp } → requester
 *  - group:join_rejected       { conversationId, userId, requestId, reviewedBy, timestamp } → requester
 *  - group:poll_created        { conversationId, poll, createdBy, createdByName, timestamp } → all members
 *  - group:poll_voted          { conversationId, pollId, voterId, voterName, optionIds, options, timestamp } → all members
 *  - group:poll_closed         { conversationId, pollId, closedBy, closedByName, options, timestamp } → all members
 */
@Injectable()
export class GroupEventsConsumer {
  private readonly logger = createLogger(GroupEventsConsumer.name);
  private readonly MEMBERS_CACHE_TTL = 600; // 10 min

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly userEnrichment: UserEnrichmentService,

    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,

    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  // ─── Settings updated ────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.SETTINGS_UPDATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleSettingsUpdated(payload: any): Promise<void> {
    const { conversationId } = payload;
    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(conversationId),
      this.userEnrichment.getDisplayNames([payload.updatedBy]),
    ]);
    await this.notifyUsers(memberIds, {
      event: 'group:settings_updated',
      data: {
        conversationId,
        changes: payload.changes ?? {},
        updatedBy: payload.updatedBy,
        updatedByName: names.get(payload.updatedBy),
        timestamp: payload.timestamp,
      },
    });
    this.logger.log(
      `group:settings_updated → ${memberIds.length} members (${conversationId})`,
    );
  }

  // ─── Member role changed ─────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleMemberRoleChanged(payload: any): Promise<void> {
    const { conversationId } = payload;
    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(conversationId),
      this.userEnrichment.getDisplayNames([payload.changedBy, payload.userId]),
    ]);
    await this.notifyUsers(memberIds, {
      event: 'group:member_role_changed',
      data: {
        conversationId,
        userId: payload.userId,
        userName: names.get(payload.userId),
        newRole: payload.newRole,
        changedBy: payload.changedBy,
        changedByName: names.get(payload.changedBy),
        timestamp: payload.timestamp,
      },
    });
    this.logger.log(
      `group:member_role_changed → ${memberIds.length} members (${conversationId})`,
    );
  }

  // ─── Member kicked ───────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.MEMBER_KICKED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleMemberKicked(payload: any): Promise<void> {
    const { conversationId, userId: kickedUserId } = payload;

    // Run cache invalidation and name resolution in parallel
    const [, names] = await Promise.all([
      this.invalidateMembersCache(conversationId),
      this.userEnrichment.getDisplayNames([payload.kickedBy, kickedUserId]),
    ]);

    const kickEventData = {
      conversationId,
      userId: kickedUserId,
      userName: names.get(kickedUserId),
      kickedBy: payload.kickedBy,
      kickedByName: names.get(payload.kickedBy),
      timestamp: payload.timestamp,
    };

    // Notify the kicked user directly (they may not be in the members list anymore)
    await this.chatGateway.notifySelf(kickedUserId, {
      event: 'group:member_kicked',
      data: kickEventData,
    });

    // Best-effort room eviction — catch errors so a socket/Redis failure does NOT
    // cause a Kafka retry that would re-emit group:member_kicked to the kicked user.
    await this.chatGateway
      .forceLeaveConversation(kickedUserId, conversationId, {
        reason: 'group-member-kicked',
        message: 'You have been removed from this group',
      })
      .catch((e: Error) =>
        this.logger.warn(
          `group:member_kicked: forceLeaveConversation failed for ${kickedUserId} (${conversationId}): ${e.message}`,
        ),
      );

    // Notify remaining members so they can update the member list in their UI
    const memberIds = await this.getConversationMembers(conversationId);
    if (memberIds.length > 0) {
      await this.notifyUsers(memberIds, {
        event: 'group:member_kicked',
        data: kickEventData,
      });
    }

    this.logger.log(
      `group:member_kicked: kicked=${kickedUserId} notified ${memberIds.length} remaining members (${conversationId})`,
    );
  }

  // ─── Group disbanded ─────────────────────────────────────────────────────

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.DISBANDED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleDisbanded(payload: any): Promise<void> {
    const { conversationId } = payload;

    // Prefer the durable member snapshot captured before deletion; fall back to cache/service.
    const memberIds = payload.memberIds?.length
      ? payload.memberIds
      : await this.getConversationMembers(conversationId);
    const [, names] = await Promise.all([
      this.invalidateMembersCache(conversationId),
      this.userEnrichment.getDisplayNames([payload.disbandedBy]),
    ]);

    await this.notifyUsers(memberIds, {
      event: 'group:disbanded',
      data: {
        conversationId,
        disbandedBy: payload.disbandedBy,
        disbandedByName: names.get(payload.disbandedBy),
        timestamp: payload.timestamp,
      },
    });

    // Best-effort room eviction — use allSettled so individual socket/Redis errors
    // do NOT cause the Kafka handler to throw and trigger a retry that would
    // re-emit group:disbanded to all members a second time.
    const leaveResults = await Promise.allSettled(
      memberIds.map((userId) =>
        this.chatGateway.forceLeaveConversation(userId, conversationId, {
          reason: 'group-disbanded',
          message: 'This group has been disbanded',
        }),
      ),
    );
    const failedLeaves = leaveResults.filter((r) => r.status === 'rejected');
    if (failedLeaves.length > 0) {
      this.logger.warn(
        `group:disbanded: ${failedLeaves.length}/${memberIds.length} forceLeaveConversation calls failed (${conversationId})`,
      );
    }

    this.logger.log(
      `group:disbanded → ${memberIds.length} members (${conversationId})`,
    );
  }

  // ─── Join-request flow ───────────────────────────────────────────────────

  /**
   * A new join request came in → notify all admins/owners so they can
   * see and act on it. We broadcast to ALL members and let the client-side
   * filter by role (admins/owners will show the approval UI, others ignore it).
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.JOIN_REQUESTED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleJoinRequested(payload: any): Promise<void> {
    const { conversationId } = payload;

    // Enrich display names — include invitedBy when source is member_invite
    const userIdsToResolve = [payload.userId];
    if (payload.invitedBy) userIdsToResolve.push(payload.invitedBy);

    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(conversationId),
      this.userEnrichment.getDisplayNames(userIdsToResolve),
    ]);
    await this.notifyUsers(memberIds, {
      event: 'group:join_requested',
      data: {
        conversationId,
        userId: payload.userId,
        userName: names.get(payload.userId),
        requestId: payload.requestId,
        requestMessage: payload.requestMessage,
        source: payload.source ?? 'request',
        ...(payload.invitedBy
          ? {
              invitedBy: payload.invitedBy,
              invitedByName: names.get(payload.invitedBy),
            }
          : {}),
        timestamp: payload.timestamp,
      },
    });
    this.logger.log(
      `group:join_requested → ${memberIds.length} members (${conversationId}) source=${payload.source ?? 'request'}`,
    );
  }

  /** Approved → notify the requester so their UI can open the conversation. */
  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.JOIN_APPROVED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleJoinApproved(payload: any): Promise<void> {
    // Invalidate cache so next broadcast includes the new member
    await this.invalidateMembersCache(payload.conversationId);
    const names = await this.userEnrichment.getDisplayNames([
      payload.userId,
      payload.reviewedBy,
    ]);

    await this.chatGateway.notifySelf(payload.userId, {
      event: 'group:join_approved',
      data: {
        conversationId: payload.conversationId,
        userId: payload.userId,
        userName: names.get(payload.userId),
        requestId: payload.requestId,
        reviewedBy: payload.reviewedBy,
        reviewedByName: names.get(payload.reviewedBy),
        timestamp: payload.timestamp,
      },
    });

    // Also let existing members know someone joined
    const memberIds = await this.getConversationMembers(payload.conversationId);
    const existingMemberIds = memberIds.filter((id) => id !== payload.userId);
    if (memberIds.length > 0) {
      const approvedData = {
        conversationId: payload.conversationId,
        userId: payload.userId,
        userName: names.get(payload.userId),
        requestId: payload.requestId,
        reviewedBy: payload.reviewedBy,
        reviewedByName: names.get(payload.reviewedBy),
        timestamp: payload.timestamp,
      };
      await this.notifyUsers(existingMemberIds, {
        event: 'group:join_approved',
        data: approvedData,
      });
      await this.notifyUsers(memberIds, {
        event: 'conversation:member-added',
        data: {
          conversationId: payload.conversationId,
          addedBy: payload.reviewedBy,
          addedByName: names.get(payload.reviewedBy),
          addedUsers: [
            {
              id: payload.userId,
              displayName: names.get(payload.userId),
            },
          ],
          conversationType: 'group',
          memberCount: memberIds.length,
          timestamp: payload.timestamp,
          source: 'join_approved',
        },
      });
    }

    this.logger.log(
      `group:join_approved: user=${payload.userId} conversation=${payload.conversationId}`,
    );
  }

  /** Rejected → only the requester needs to know. */
  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.JOIN_REJECTED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handleJoinRejected(payload: any): Promise<void> {
    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(payload.conversationId),
      this.userEnrichment.getDisplayNames([payload.userId, payload.reviewedBy]),
    ]);
    const rejectedData = {
      conversationId: payload.conversationId,
      userId: payload.userId,
      userName: names.get(payload.userId),
      requestId: payload.requestId,
      reviewedBy: payload.reviewedBy,
      reviewedByName: names.get(payload.reviewedBy),
      timestamp: payload.timestamp,
    };

    await this.chatGateway.notifySelf(payload.userId, {
      event: 'group:join_rejected',
      data: rejectedData,
    });
    await this.notifyUsers(memberIds, {
      event: 'group:join_rejected',
      data: rejectedData,
    });

    this.logger.log(
      `group:join_rejected: user=${payload.userId} conversation=${payload.conversationId}`,
    );
  }

  // ─── Poll lifecycle ──────────────────────────────────────────────────────
  //
  // The conversation-service writes POLL_CREATED / POLL_VOTED / POLL_CLOSED
  // events to its transactional outbox; the outbox relay publishes them to
  // Kafka under topics `group.event.poll_*`. The gateway fans them out to
  // every current member's personal room so connected clients can patch the
  // poll UI without re-fetching.

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.POLL_CREATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handlePollCreated(payload: any): Promise<void> {
    const { conversationId, creatorId } = payload;
    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(conversationId),
      this.userEnrichment.getDisplayNames([creatorId]),
    ]);

    await this.notifyUsers(memberIds, {
      event: 'group:poll_created',
      data: {
        conversationId,
        poll: {
          id: payload.pollId,
          conversationId,
          creatorId,
          question: payload.question,
          options: payload.options,
          multipleChoice: payload.multipleChoice ?? false,
          deadline: payload.deadline ?? null,
          isClosed: false,
        },
        createdBy: creatorId,
        createdByName: names.get(creatorId),
        timestamp: payload.timestamp,
      },
    });

    this.logger.log(
      `group:poll_created → ${memberIds.length} members (poll=${payload.pollId} conversation=${conversationId})`,
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.POLL_VOTED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handlePollVoted(payload: any): Promise<void> {
    const { conversationId, userId: voterId } = payload;
    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(conversationId),
      this.userEnrichment.getDisplayNames([voterId]),
    ]);

    await this.notifyUsers(memberIds, {
      event: 'group:poll_voted',
      data: {
        conversationId,
        pollId: payload.pollId,
        voterId,
        voterName: names.get(voterId),
        optionIds: payload.optionIds ?? [],
        // Full snapshot of options after the vote so clients can replace local state
        options: payload.updatedOptions ?? payload.options ?? [],
        timestamp: payload.timestamp,
      },
    });

    this.logger.log(
      `group:poll_voted → ${memberIds.length} members (poll=${payload.pollId} voter=${voterId})`,
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.GROUP.POLL_CLOSED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_GROUP_EVENTS,
    fromBeginning: false,
  })
  async handlePollClosed(payload: any): Promise<void> {
    const { conversationId, closedBy } = payload;
    const [memberIds, names] = await Promise.all([
      this.getConversationMembers(conversationId),
      this.userEnrichment.getDisplayNames([closedBy]),
    ]);

    await this.notifyUsers(memberIds, {
      event: 'group:poll_closed',
      data: {
        conversationId,
        pollId: payload.pollId,
        closedBy,
        closedByName: names.get(closedBy),
        options: payload.finalOptions ?? payload.options ?? [],
        timestamp: payload.timestamp,
      },
    });

    this.logger.log(
      `group:poll_closed → ${memberIds.length} members (poll=${payload.pollId})`,
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getConversationMembers(
    conversationId: string,
  ): Promise<string[]> {
    const cacheKey = `conversation:${conversationId}:members`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as string[];
    }

    try {
      const result = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_MEMBER_IDS, {
          conversationId,
        }),
      );

      const memberIds: string[] = result.memberIds ?? [];
      await this.redis.setex(
        cacheKey,
        this.MEMBERS_CACHE_TTL,
        JSON.stringify(memberIds),
      );
      return memberIds;
    } catch (error) {
      this.logger.error(
        `Failed to fetch members for ${conversationId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async invalidateMembersCache(conversationId: string): Promise<void> {
    await this.redis
      .del(`conversation:${conversationId}:members`)
      .catch(() => {});
  }

  private async notifyUsers(
    userIds: string[],
    payload: { event: string; data: any },
  ): Promise<void> {
    await Promise.all(
      [...new Set(userIds)].map((userId) =>
        this.chatGateway.notifySelf(userId, payload),
      ),
    );
  }
}

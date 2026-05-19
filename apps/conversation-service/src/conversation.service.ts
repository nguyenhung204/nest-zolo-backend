import { Injectable, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  CONVERSATION_REPOSITORY,
  CONVERSATION_MEMBER_REPOSITORY,
} from './domain/interfaces/repositories.interface';
import type {
  IConversationRepository,
  IConversationMemberRepository,
} from './domain/interfaces/repositories.interface';
import { Conversation } from './domain/entities/conversation.entity';
import { ConversationMember } from './domain/entities/conversation-member.entity';
import { GroupJoinRequest } from './domain/entities/group-join-request.entity';
import {
  ConversationType,
  MemberRole,
  JoinRequestStatus,
  CONVERSATION_LIMITS,
  KAFKA_TOPICS,
  REDIS_KEYS,
  createLogger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import type {
  MemberAddedEvent,
  MemberRemovedEvent,
} from '@app/service-contracts';

@Injectable()
export class ConversationService {
  private readonly logger = createLogger(ConversationService.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepo: IConversationRepository,
    @Inject(CONVERSATION_MEMBER_REPOSITORY)
    private readonly memberRepo: IConversationMemberRepository,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly outboxRepository: OutboxRepository,

    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  /**
   * Create Conversation with Business Rules
   *
   * - role: Creator gets OWNER role, others get MEMBER
   * - metadata: Store channel-specific settings
   */
  async createConversation(
    type: ConversationType,
    memberIds: string[],
    createdBy: string,
    name?: string,
    description?: string,
    metadata?: Record<string, any>,
    avatarMediaId?: string,
  ): Promise<Conversation> {
    // Normalize type to lowercase to guard against uppercase strings from callers
    const normalizedType = (type as string)?.toLowerCase() as ConversationType;

    // Normalize: ensure createdBy is in memberIds and remove duplicates
    const normalizedMemberIds = [...new Set([createdBy, ...memberIds])];
    const memberCount = normalizedMemberIds.length;

    // Validate member count by type
    this.validateMemberCount(normalizedType, memberCount);

    // For DIRECT, check if already exists
    if (normalizedType === ConversationType.DIRECT) {
      const existing = await this.conversationRepo.findDirectConversation(
        normalizedMemberIds[0],
        normalizedMemberIds[1],
      );
      if (existing) {
        this.logger.log(`DIRECT conversation already exists: ${existing.id}`);
        return existing;
      }
    }

    // Use transaction to ensure atomicity with outbox
    const conversation = await this.dataSource.transaction(async (manager) => {
      //  Use manager.getRepository for true transaction atomicity
      const convRepo = manager.getRepository(Conversation);
      const memRepo = manager.getRepository(ConversationMember);

      // Create conversation with correct memberCount
      const conversation = await convRepo.save(
        convRepo.create({
          type: normalizedType,
          name: normalizedType === ConversationType.DIRECT ? undefined : name,
          description,
          avatarMediaId: normalizedType === ConversationType.DIRECT ? undefined : avatarMediaId,
          memberCount,
          maxOffset: 0,
          createdBy,
          metadata: metadata ?? undefined,
        }),
      );

      // Bulk insert all members at once (fast)
      // Enterprise (Phase 1): Creator gets OWNER role
      const memberEntities = normalizedMemberIds.map((userId) => ({
        conversationId: conversation.id,
        userId,
        role: userId === createdBy ? MemberRole.OWNER : MemberRole.MEMBER,
        lastSeenOffset: 0,
        joinedAt: new Date(),
      }));

      await memRepo.save(memberEntities);

      this.logger.log(
        `Created ${normalizedType} conversation ${conversation.id} with ${memberCount} members`,
      );

      // Write to outbox instead of direct Kafka publish
      await this.outboxRepository.create(
        {
          aggregateType: 'conversation',
          aggregateId: conversation.id,
          eventType: 'conversation.created',
          payload: {
            conversationId: conversation.id,
            type: normalizedType,
            memberIds: normalizedMemberIds,
            createdBy,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.CONVERSATION_CREATED,
        },
        manager,
      );

      return conversation;
    });

    // Write-through: populate Redis membership cache immediately after DB commit.
    // This removes the dependency on the async MEMBER_ADDED Kafka consumer
    // (which may be delayed during consumer group rebalances) for cache warm-up.
    const memberCacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversation.id);
    const TTL_7_DAYS = 7 * 24 * 60 * 60;
    const wPipeline = this.redis.pipeline();
    wPipeline.sadd(memberCacheKey, ...normalizedMemberIds);
    for (const uid of normalizedMemberIds) {
      const role = uid === createdBy ? MemberRole.OWNER : MemberRole.MEMBER;
      wPipeline.set(`${memberCacheKey}:${uid}:role`, role, 'EX', TTL_7_DAYS);
    }
    wPipeline.expire(memberCacheKey, TTL_7_DAYS);
    await wPipeline.exec().catch((err) =>
      this.logger.warn(
        `Cache write-through for createConversation ${conversation.id} (non-critical): ${err.message}`,
      ),
    );

    return conversation;
  }

  /**
   * Add Members (ATOMIC)
   *
   * Any group member can add new members:
   * - If `joinApprovalRequired = false` → add directly (instant).
   * - If `joinApprovalRequired = true`  → create pending join requests
   *   (same as invite-link flow); OWNER/ADMIN must approve.
   *
   * Returns a result object so the caller knows which path was taken.
   */
  async addMembers(
    conversationId: string,
    userIds: string[],
    addedBy: string,
  ): Promise<{
    requiresApproval: boolean;
    addedUserIds?: string[];
    pendingRequests?: Array<{ requestId: string; userId: string }>;
    skippedAlreadyMembers?: string[];
    skippedAlreadyRequested?: string[];
  }> {
    // ── Fetch conversation + verify membership ─────────────────────────────
    const conversation = await this.dataSource
      .getRepository(Conversation)
      .findOne({ where: { id: conversationId } });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const adderMember = await this.dataSource
      .getRepository(ConversationMember)
      .findOne({ where: { conversationId, userId: addedBy } });

    if (!adderMember) {
      throw new ForbiddenException(
        'You are not a member of this conversation',
      );
    }
    // ── Branch: approval required → create join requests ───────────────────
    if (conversation.joinApprovalRequired) {
      return this.addMembersWithApproval(
        conversationId,
        userIds,
        addedBy,
        conversation,
      );
    }

    // ── Branch: direct add (no approval) ───────────────────────────────────
    return this.addMembersDirect(
      conversationId,
      userIds,
      addedBy,
      conversation,
    );
  }

  /**
   * Direct-add path (joinApprovalRequired = false).
   * Inserts members immediately + emits member.added Kafka event.
   */
  private async addMembersDirect(
    conversationId: string,
    userIds: string[],
    addedBy: string,
    conversation: Conversation,
  ): Promise<{
    requiresApproval: false;
    addedUserIds: string[];
  }> {
    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(ConversationMember);

      // Bulk insert members with ON CONFLICT (idempotent + fast)
      if (userIds.length > 0) {
        await memberRepo
          .createQueryBuilder()
          .insert()
          .into(ConversationMember)
          .values(
            userIds.map((userId) => ({
              conversationId,
              userId,
              role: MemberRole.MEMBER,
              lastSeenOffset: 0,
              joinedAt: new Date(),
            })),
          )
          .orIgnore() // Postgres ON CONFLICT DO NOTHING
          .execute();
      }

      // Update member count
      const newCount = await memberRepo.count({ where: { conversationId } });
      await manager
        .getRepository(Conversation)
        .update(conversationId, { memberCount: newCount });

      this.logger.log(
        `Added ${userIds.length} members to ${conversationId}, new count: ${newCount}`,
      );

      // Write member.added event to outbox (atomic with DB updates)
      const rolesMap: Record<string, string> = {};
      userIds.forEach((uid) => { rolesMap[uid] = MemberRole.MEMBER; });

      const memberAddedPayload: MemberAddedEvent = {
        conversationId,
        userIds,
        addedBy,
        roles: rolesMap,
        conversationType: conversation.type,
        newMemberCount: newCount,
        timestamp: new Date(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'conversation',
          aggregateId: conversationId,
          eventType: 'member.added',
          payload: memberAddedPayload,
          kafkaTopic: KAFKA_TOPICS.MEMBER_ADDED,
        },
        manager,
      );
    });

    // trimmed dead branch
    const addCacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    const TTL_7_DAYS_ADD = 7 * 24 * 60 * 60;
    const addPipeline = this.redis.pipeline();
    addPipeline.sadd(addCacheKey, ...userIds);
    for (const uid of userIds) {
      addPipeline.set(
        `${addCacheKey}:${uid}:role`,
        MemberRole.MEMBER,
        'EX',
        TTL_7_DAYS_ADD,
      );
    }
    addPipeline.expire(addCacheKey, TTL_7_DAYS_ADD);
    await addPipeline.exec().catch((err) =>
      this.logger.warn(
        `Cache write-through for addMembers ${conversationId} (non-critical): ${err.message}`,
      ),
    );

    return { requiresApproval: false, addedUserIds: userIds };
  }

  /**
   * Approval-required path (joinApprovalRequired = true).
   * Creates pending GroupJoinRequest entries for each user.
   * OWNER/ADMIN must approve before the user actually joins.
   */
  private async addMembersWithApproval(
    conversationId: string,
    userIds: string[],
    addedBy: string,
    conversation: Conversation,
  ): Promise<{
    requiresApproval: true;
    pendingRequests: Array<{ requestId: string; userId: string }>;
    skippedAlreadyMembers: string[];
    skippedAlreadyRequested: string[];
  }> {
    const pendingRequests: Array<{ requestId: string; userId: string }> = [];
    const skippedAlreadyMembers: string[] = [];
    const skippedAlreadyRequested: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(ConversationMember);
      const joinReqRepo = manager.getRepository(GroupJoinRequest);

      for (const userId of userIds) {
        const alreadyMember = await memberRepo.existsBy({
          conversationId,
          userId,
        });
        if (alreadyMember) {
          skippedAlreadyMembers.push(userId);
          continue;
        }

        // Skip if already has a PENDING request
        const existingReq = await joinReqRepo.findOne({
          where: { conversationId, userId },
        });
        if (existingReq?.status === JoinRequestStatus.PENDING) {
          skippedAlreadyRequested.push(userId);
          continue;
        }

        // Remove any old rejected/approved entry (unique constraint)
        if (existingReq) {
          await joinReqRepo.delete({ conversationId, userId });
        }

        // Create new pending join request
        const request = await joinReqRepo.save(
          joinReqRepo.create({
            conversationId,
            userId,
            source: 'member_invite',
            invitedBy: addedBy,
            status: JoinRequestStatus.PENDING,
          }),
        );

        pendingRequests.push({ requestId: request.id, userId });

        // Emit group.join_requested event per user
        await this.outboxRepository.create(
          {
            aggregateType: 'group',
            aggregateId: conversationId,
            eventType: 'group.join_requested',
            payload: {
              conversationId,
              userId,
              requestId: request.id,
              source: 'member_invite',
              invitedBy: addedBy,
              timestamp: new Date(),
            },
            kafkaTopic: KAFKA_TOPICS.GROUP.JOIN_REQUESTED,
            kafkaKey: conversationId,
          },
          manager,
        );
      }
    });

    this.logger.log(
      `Member invite (approval required): conversation=${conversationId} ` +
      `invitedBy=${addedBy} pending=${pendingRequests.length} ` +
      `skippedMembers=${skippedAlreadyMembers.length} ` +
      `skippedRequested=${skippedAlreadyRequested.length}`,
    );

    return {
      requiresApproval: true,
      pendingRequests,
      skippedAlreadyMembers,
      skippedAlreadyRequested,
    };
  }

  /**
   * Remove Members (ATOMIC)
   *
   * Critical Fixes:
   * - All DB operations + outbox in single transaction
   * - Check admin role before removal
   * - Update count atomically
   */
  async removeMembers(
    conversationId: string,
    userIds: string[],
    removedBy: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // stable as of polish pass
      const conversation = await manager
        .getRepository(Conversation)
        .findOne({ where: { id: conversationId } });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      // 2. Check permission - must be admin/owner
      const memberRepo = manager.getRepository(ConversationMember);
      const removerMember = await memberRepo
        .createQueryBuilder('m')
        .where('m.conversationId = :conversationId', { conversationId })
        .andWhere('m.userId = :userId', { userId: removedBy })
        .getOne();

      if (!removerMember) {
        throw new ForbiddenException(
          'You are not a member of this conversation',
        );
      }

      if (
        removerMember.role !== MemberRole.OWNER &&
        removerMember.role !== MemberRole.ADMIN
      ) {
        throw new ForbiddenException('Only admins can remove members');
      }

      // 3. Remove members (bulk delete)
      if (userIds.length > 0) {
        await memberRepo
          .createQueryBuilder()
          .delete()
          .from(ConversationMember)
          .where('conversationId = :conversationId', { conversationId })
          .andWhere('userId IN (:...userIds)', { userIds })
          .execute();
      }

      // 4. Update member count
      const newCount = await memberRepo.count({ where: { conversationId } });
      await manager
        .getRepository(Conversation)
        .update(conversationId, { memberCount: newCount });

      this.logger.log(
        `Removed ${userIds.length} members from ${conversationId}, new count: ${newCount}`,
      );

      // 5. Write to outbox (atomic with DB updates)
      const memberRemovedPayload: MemberRemovedEvent = {
        conversationId,
        userIds,
        removedBy,
        conversationType: conversation.type,
        newMemberCount: newCount,
        timestamp: new Date(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'conversation',
          aggregateId: conversationId,
          eventType: 'member.removed',
          payload: memberRemovedPayload,
          kafkaTopic: KAFKA_TOPICS.MEMBER_REMOVED,
        },
        manager,
      );
    });

    // Immediate cache bust — don't wait for Kafka MEMBER_REMOVED event.
    // Closes the window where a kicked user could still pass the Redis membership check.
    const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    const pipeline = this.redis.pipeline();
    for (const uid of userIds) {
      pipeline.srem(cacheKey, uid);
      pipeline.del(`${cacheKey}:${uid}:role`);
    }
    // polish: simplified
    await pipeline.exec().catch((err) =>
      this.logger.warn(
        `Cache bust failed for removeMembers (non-critical): ${err.message}`,
      ),
    );
  }

  /**
   * Get Conversation
   */
  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<Conversation | any> {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Load all members (single query - also used for membership check)
    const membersMap = await this.memberRepo.findByConversationIds([conversationId]);
    const memberList = membersMap.get(conversationId) || [];

    // Check membership from loaded list (avoid extra DB round-trip)
    const isMember = memberList.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    // Return raw participants (userId + role only).
    // User profile enrichment (username, displayName, avatarUrl) is handled at Gateway.
    const participants = memberList.map((m) => ({
      userId: m.userId,
      role: m.role,
    }));

    // memberCount is a denormalized counter that can drift over time.
    // Always override it with the live count from the member query
    // so the API response is always internally consistent.
    const actualMemberCount = memberList.length;

    return { ...conversation, memberCount: actualMemberCount, participants };
  }

  /**
   * Find conversation by ID (internal use - no membership check)
   */
  async findById(conversationId: string): Promise<Conversation | null> {
    return await this.conversationRepo.findById(conversationId);
  }

  /**
   * List User's Conversations with Member Details
   */
  /**
   * List Conversations with Optimization
   *
   * Fixed N+1 query: Batch load all members via repository
   * For DIRECT conversations: Fetch user info of the other person
   */
  async listConversations(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[Conversation[], number]> {
    const [conversations, total] = await this.conversationRepo.findByUserId(
      userId,
      page,
      limit,
    );

    if (conversations.length === 0) {
      return [[], 0];
    }

    // Only load members for DIRECT conversations (GROUP/others don't need it in list)
    const directConversations = conversations.filter(
      (c) => c.type === ConversationType.DIRECT,
    );
    const directIds = directConversations.map((c) => c.id);
    const membersByConvId =
      directIds.length > 0
        ? await this.memberRepo.findByConversationIds(directIds)
        : new Map();
    const otherUserIds = directConversations
      .map((conv) => {
        const members = membersByConvId.get(conv.id) || [];
        const otherMember = members.find((m) => m.userId !== userId);
        return otherMember?.userId;
      })
      .filter(Boolean);

    // Build raw output: DIRECT conversations carry otherUserId for Gateway enrichment.
    // User profile fields (username, displayName, avatarUrl) are resolved at Gateway.
    const rawConversations = conversations.map((conv) => {
      if (conv.type === ConversationType.DIRECT) {
        const members = membersByConvId.get(conv.id) || [];
        const otherMember = members.find((m) => m.userId !== userId);
        return { ...conv, otherUserId: otherMember?.userId ?? null };
      }
      return { ...conv };
    });

    return [rawConversations as any, total];
  }

  /**
   * Search conversations by name for a user.
   * Unlike listConversations, this ignores deletedUntil so that a user
   * can find conversations they have previously cleared/hidden.
   * Only GROUP/ANNOUNCEMENT conversations (which have a name field) are matched;
   * DIRECT conversations are excluded at repository level since their name is null.
   */
  async searchConversations(
    userId: string,
    query: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[Conversation[], number]> {
    const [conversations, total] =
      await this.conversationRepo.searchByUserIdAndQuery(
        userId,
        query,
        page,
        limit,
      );

    if (conversations.length === 0) {
      return [[], 0];
    }

    return [conversations as any, total];
  }

  /**
   * Check if user is member
   */
  async isMember(conversationId: string, userId: string): Promise<boolean> {
    return await this.memberRepo.isMember(conversationId, userId);
  }

  /**
   * Check if two users share at least one conversation (used for media authorization)
   */
  async haveSharedConversation(
    userId1: string,
    userId2: string,
  ): Promise<boolean> {
    return await this.memberRepo.haveSharedConversation(userId1, userId2);
  }

  /**
   * Get member IDs
   */
  async getMemberIds(conversationId: string): Promise<string[]> {
    return await this.memberRepo.getMemberIds(conversationId);
  }

  /**
   * Get members with their roles (Enterprise Phase 1)
   * Returns array of { userId, role } for ACL validation
   *
   * @param conversationId - Conversation ID
   * @returns Array of { userId: string, role: MemberRole }
   */
  async getMembersWithRoles(
    conversationId: string,
  ): Promise<Array<{ userId: string; role: string }>> {
    const members = await this.memberRepo.findByConversationIds([
      conversationId,
    ]);
    const memberList = members.get(conversationId) || [];

    return memberList;
  }

  /**
   * Increment max offset for ALL conversation types (called by MessageStore)
   * Atomically increments and returns the new offset for message ordering
   */
  async incrementMaxOffset(conversationId: string): Promise<number> {
    return await this.conversationRepo.incrementMaxOffset(conversationId);
  }

  /**
   * Update seen cursor for user in conversation
   * Cursor only increases, never decreases (invariant)
   * Used when user opens conversation or explicitly marks as read
   *
   * @param upToOffset - Mark as seen up to this offset (usually conversations.maxOffset)
   */
  async updateSeenCursor(
    conversationId: string,
    userId: string,
    upToOffset: number,
  ): Promise<void> {
    // Verify conversation exists and user is member
    const isMember = await this.memberRepo.isMember(conversationId, userId);
    if (!isMember) {
      throw new ForbiddenException('User is not a member of this conversation');
    }

    // Update cursor directly (no outbox needed — cursor updates are internal state changes
    // that do not need to be broadcast as Kafka events to other services)
    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(ConversationMember);
      await memberRepo
        .createQueryBuilder()
        .update(ConversationMember)
        .set({
          lastSeenOffset: () =>
            'GREATEST(COALESCE(last_seen_offset, 0), :upToOffset)',
        })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('user_id = :userId', { userId })
        .setParameters({ upToOffset })
        .execute();
    });

    this.logger.log(
      `Updated seen cursor for user ${userId} in ${conversationId}: upTo=${upToOffset}`,
    );
  }

  /**
   * Update delivered cursor for user in conversation
   * Cursor only increases, never decreases (invariant)
   * Used when user receives message events or fetches messages
   *
   * @param upToOffset - Mark as delivered up to this offset
   */
  async updateDeliveredCursor(
    conversationId: string,
    userId: string,
    upToOffset: number,
  ): Promise<void> {
    // Verify conversation exists and user is member
    const isMember = await this.memberRepo.isMember(conversationId, userId);
    if (!isMember) {
      throw new ForbiddenException('User is not a member of this conversation');
    }

    // Update cursor directly (no outbox needed — cursor updates are internal state changes
    // that do not need to be broadcast as Kafka events to other services)
    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(ConversationMember);
      await memberRepo
        .createQueryBuilder()
        .update(ConversationMember)
        .set({
          lastDeliveredOffset: () =>
            'GREATEST(COALESCE(last_delivered_offset, 0), :upToOffset)',
        })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('user_id = :userId', { userId })
        .setParameters({ upToOffset })
        .execute();
    });

    this.logger.log(
      `Updated delivered cursor for user ${userId} in ${conversationId}: upTo=${upToOffset}`,
    );
  }

  /**
   * Get all member cursors for a conversation
   * Used for computing message status on-demand
   *
   * @returns Map of userId -> { lastSeenOffset, lastDeliveredOffset }
   */
  async getMemberCursors(
    conversationId: string,
  ): Promise<Map<string, { seen: number; delivered: number }>> {
    const members = await this.memberRepo.getMemberCursors(conversationId);
    const cursorMap = new Map<string, { seen: number; delivered: number }>();

    for (const member of members) {
      cursorMap.set(member.userId, {
        seen: member.lastSeenOffset || 0,
        delivered: member.lastDeliveredOffset || 0,
      });
    }

    return cursorMap;
  }

  /**
   * @deprecated Use updateSeenCursor instead - maintains backward compatibility
   */
  async updateLastSeenOffset(
    conversationId: string,
    userId: string,
    offset: number,
  ): Promise<void> {
    return this.updateSeenCursor(conversationId, userId, offset);
  }

  /**
   * Get unread count for a conversation
   * Formula: maxOffset - lastSeenOffset (O(1) calculation)
   */
  async getUnreadCount(
    conversationId: string,
    userId: string,
  ): Promise<number> {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Check membership before returning unread count (authorization)
    const isMember = await this.memberRepo.isMember(conversationId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    // Unread count applies to ALL conversation types (DIRECT/GROUP/ANNOUNCEMENT)
    const lastSeenOffset = await this.memberRepo.getLastSeenOffset(
      conversationId,
      userId,
    );
    const maxOffset = conversation.maxOffset || 0;
    const unreadCount = maxOffset - (lastSeenOffset || 0);

    return Math.max(0, unreadCount);
  }

  /**
   * Clear a conversation for one member only.
   *
   * This does not delete messages or affect other members. It moves the
   * member's deletedUntil cursor to the current conversation maxOffset so
   * existing messages are hidden; newer messages remain visible.
   */
  async clearConversationForUser(
    conversationId: string,
    userId: string,
  ): Promise<{ deletedUntil: number }> {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const maxOffset = Number(conversation.maxOffset ?? 0);
    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(ConversationMember)
        .createQueryBuilder()
        .update(ConversationMember)
        .set({
          deletedUntil: () =>
            'GREATEST(COALESCE(deleted_until, 0), :maxOffset)',
        })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('user_id = :userId', { userId })
        .setParameters({ maxOffset })
        .execute();
      if (!result.affected) {
        throw new ForbiddenException('You are not a member of this conversation');
      }
    });

    return { deletedUntil: maxOffset };
  }

  /**
   * Validate member count by type (Enterprise version)
   */
  private validateMemberCount(type: ConversationType, count: number): void {
    type Validator = (n: number) => string | null;

    const validators: Record<ConversationType, Validator> = {
      [ConversationType.DIRECT]: (n) =>
        n !== CONVERSATION_LIMITS.DIRECT_MEMBERS
          ? `DIRECT conversation must have exactly ${CONVERSATION_LIMITS.DIRECT_MEMBERS} members`
          : null,
      [ConversationType.GROUP]: (n) => {
        if (n < CONVERSATION_LIMITS.GROUP_MIN_MEMBERS)
          return `GROUP must have at least ${CONVERSATION_LIMITS.GROUP_MIN_MEMBERS} members`;
        if (n > CONVERSATION_LIMITS.GROUP_MAX_MEMBERS)
          return `GROUP cannot exceed ${CONVERSATION_LIMITS.GROUP_MAX_MEMBERS} members`;
        return null;
      },
      [ConversationType.ANNOUNCEMENT]: (n) =>
        n < CONVERSATION_LIMITS.GROUP_MIN_MEMBERS
          ? `ANNOUNCEMENT must have at least ${CONVERSATION_LIMITS.GROUP_MIN_MEMBERS} members`
          : null,
    };

    const error = validators[type]?.(count);
    if (error) throw new BadRequestException(error);
  }

  /**
   * Create DIRECT conversation between two friends
   * Called by FriendshipEventConsumer when friend request is accepted
   *
   * @param userAId - First user ID
   * @param userBId - Second user ID
   * @returns Created conversation
   */
  async createDirectConversation(
    userAId: string,
    userBId: string,
  ): Promise<Conversation> {
    //  Race-safe: Try insert, catch conflict, fetch existing
    // The DB migration already created unique index on direct_pair_key
    try {
      const conversation = await this.createConversation(
        ConversationType.DIRECT,
        [userAId, userBId],
        userAId,
        undefined,
        undefined,
      );

      this.logger.log(
        ` Created DIRECT conversation ${conversation.id} for ${userAId}  ${userBId}`,
      );
      return conversation;
    } catch (error: any) {
      // Postgres unique violation code: 23505
      if (error.code === '23505' && error.constraint?.includes('direct')) {
        // Conflict detected - fetch existing conversation
        const existing = await this.conversationRepo.findDirectConversation(
          userAId,
          userBId,
        );
        if (existing) {
          this.logger.log(
            `DIRECT conversation exists (race resolved): ${existing.id}`,
          );
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Archive DIRECT conversation when user is blocked
   * : Don't delete, just mark as archived/inactive
   *
   * @param userId - User who blocked
   * @param blockedUserId - User who was blocked
   */
  async archiveDirectConversation(
    userId: string,
    blockedUserId: string,
  ): Promise<void> {
    const conversation = await this.conversationRepo.findDirectConversation(
      userId,
      blockedUserId,
    );

    if (!conversation) {
      this.logger.log(
        `No DIRECT conversation found between ${userId} and ${blockedUserId}`,
      );
      return;
    }

    // post-merge cleanup
    // In a full implementation, you would have an 'archived' or 'active' status field
    // For now, just log the action
    // TODO: Add isActive or archivedAt field to Conversation entity
    this.logger.log(
      ` Archived DIRECT conversation ${conversation.id} (${userId} blocked ${blockedUserId})`,
    // kept for backwards-compat
    );

    // Note: CONVERSATION_ARCHIVED event not yet defined in KAFKA_TOPICS
    // TODO: Add to kafka-events.interface.ts if needed for real-time updates
  }

  /**
   * Update Conversation Info - Phase 4 (Enterprise ACL)
   *
   * Business Rules (R5):
   * - CH.UPDATE_INFO: OWNER/ADMIN only
   * - Can update: name, description, avatarMediaId
   *
   * Flow:
   * 1. Validate user is member
   * 2. Check permission (handled by ChatCore or Gateway)
   * 3. Update conversation
   * 4. Publish CONVERSATION_UPDATED event
   */
  async updateInfo(data: {
    conversationId: string;
    userId: string;
    name?: string;
    description?: string;
    avatarMediaId?: string;
  }): Promise<{ conversation: Conversation; previousAvatarMediaId: string | null }> {
    this.logger.log(
      `Updating conversation info: ${data.conversationId} by ${data.userId}`,
    );

    // 1. Verify user is member
    const isMember = await this.memberRepo.isMember(
      data.conversationId,
      data.userId,
    );
    if (!isMember) {
      throw new ForbiddenException('User is not a member of this conversation');
    }

    // Capture current avatar before update so Gateway can delete the old file
    const existingConv = await this.conversationRepo.findById(
      data.conversationId,
    );
    const previousAvatarMediaId = existingConv?.avatarMediaId ?? null;

    // 2. Update conversation
    await this.dataSource.transaction(async (manager) => {
      const convRepo = manager.getRepository(Conversation);

      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.avatarMediaId !== undefined) {
        updateData.avatarMediaId = data.avatarMediaId;
      }

      await convRepo.update({ id: data.conversationId }, updateData);

      // 3. Publish CONVERSATION_UPDATED event
      await this.outboxRepository.create(
        {
          aggregateType: 'conversation',
          aggregateId: data.conversationId,
          eventType: 'conversation.info_updated',
          payload: {
            conversationId: data.conversationId,
            updatedBy: data.userId,
            changes: {
              name: data.name,
              description: data.description,
              avatarMediaId: data.avatarMediaId,
            },
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.CONVERSATION_UPDATED,
        },
        manager,
      );
    });

    this.logger.log(` Conversation info updated: ${data.conversationId}`);

    // Return updated conversation
    const updatedConversation = await this.conversationRepo.findById(
      data.conversationId,
    );
    if (!updatedConversation) {
      throw new NotFoundException('Conversation not found after update');
    }
    return { conversation: updatedConversation, previousAvatarMediaId };
  }

  /**
   * Set Member Role - Phase 4 (Enterprise ACL)
   *
   * Business Rules (R5):
   * - MBR.SET_ROLE: OWNER/ADMIN only
   * - OWNER can promote to ADMIN
   * - ADMIN cannot change OWNER role
   * - Must keep at least 1 OWNER/ADMIN per channel
   *
   * Flow:
   * 1. Validate user is member
   * 2. Check permission (handled by ChatCore or Gateway)
   * 3. Update member role
   * 4. Publish MEMBER_ROLE_CHANGED event
   */
  async setMemberRole(data: {
    conversationId: string;
    targetUserId: string;
    newRole: MemberRole;
    changedBy: string;
  }): Promise<void> {
    this.logger.log(
      `Setting member role: ${data.targetUserId} to ${data.newRole} in ${data.conversationId}`,
    );
// stable as of polish pass

    // 1. Verify both users are members
    const isChangerMember = await this.memberRepo.isMember(
      data.conversationId,
      data.changedBy,
    );
    const isTargetMember = await this.memberRepo.isMember(
      data.conversationId,
      data.targetUserId,
    );

    if (!isChangerMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    if (!isTargetMember) {
      throw new NotFoundException(
        'Target user is not a member of this conversation',
      );
    }

    // TODO: revisit when scaling
    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(ConversationMember);

      // Get current role for logging
      const currentMember = await memberRepo.findOne({
        where: {
          conversationId: data.conversationId,
          userId: data.targetUserId,
        },
      });

      const oldRole = currentMember?.role;

      // Update role
      await memberRepo.update(
        {
          conversationId: data.conversationId,
          userId: data.targetUserId,
        },
        {
          role: data.newRole,
        },
      );

      // 3. Publish MEMBER_ROLE_CHANGED event
      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: data.conversationId,
          eventType: 'group.member_role_changed',
          payload: {
            conversationId: data.conversationId,
            userId: data.targetUserId,
            oldRole,
            newRole: data.newRole,
            changedBy: data.changedBy,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED,
          kafkaKey: data.conversationId,
        },
        manager,
      );
    });

    this.logger.log(
      ` Member role updated: ${data.targetUserId} → ${data.newRole}`,
    );
  }

  /**
   * Get all conversation IDs the user belongs to.
   * Lightweight query used by Realtime Gateway for fan-out
   * broadcasting of user profile update events.
   */
  async getUserConversationIds(userId: string): Promise<string[]> {
    return this.memberRepo.getConversationIdsByUserId(userId);
  }

  /**
   * Leave Conversation (self-remove).
   * Any member can leave except the OWNER — they must disband or transfer ownership first.
   */
  async leaveConversation(
    conversationId: string,
    userId: string,
    options: {
      transferOwnershipTo?: string;
      silent?: boolean;
    } = {},
  ): Promise<void> {
    const { transferOwnershipTo, silent = false } = options;
    await this.dataSource.transaction(async (manager) => {
      const conversation = await manager
        .getRepository(Conversation)
        .findOne({ where: { id: conversationId } });
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const memberRepo = manager.getRepository(ConversationMember);
      const member = await memberRepo.findOne({ where: { conversationId, userId } });
      if (!member) {
        throw new NotFoundException('You are not a member of this conversation');
      }
      if (member.role === MemberRole.OWNER) {
        if (!transferOwnershipTo || transferOwnershipTo === userId) {
          throw new ForbiddenException(
            'Owner must choose another member as the new owner before leaving.',
          );
        }

        const nextOwner = await memberRepo.findOne({
          where: { conversationId, userId: transferOwnershipTo },
        });
        if (!nextOwner) {
          throw new NotFoundException('New owner must be an existing group member');
        }

        await memberRepo.update(
          { conversationId, userId: transferOwnershipTo },
          { role: MemberRole.OWNER },
        );

        await this.outboxRepository.create(
          {
            aggregateType: 'group',
            aggregateId: conversationId,
            eventType: 'group.member_role_changed',
            payload: {
              conversationId,
              userId: transferOwnershipTo,
              newRole: MemberRole.OWNER,
              changedBy: userId,
              timestamp: new Date(),
            },
            kafkaTopic: KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED,
            kafkaKey: conversationId,
          },
          manager,
        );
      }

      await memberRepo.delete({ conversationId, userId });

      const newCount = await memberRepo.count({ where: { conversationId } });
      await manager
        .getRepository(Conversation)
        .update(conversationId, { memberCount: newCount });

      const payload: MemberRemovedEvent = {
        conversationId,
        userIds: [userId],
        removedBy: userId,
        conversationType: conversation.type,
        newMemberCount: newCount,
        timestamp: new Date(),
        reason: 'left',
        silent,
        systemMessageVisibility: silent ? 'admins' : 'all',
        ownershipTransferredTo: transferOwnershipTo,
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'conversation',
          aggregateId: conversationId,
          eventType: 'member.removed',
          payload,
          kafkaTopic: KAFKA_TOPICS.MEMBER_REMOVED,
        },
        manager,
      );
    });

    // Immediate cache bust
    const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    const pipeline = this.redis.pipeline();
    pipeline.srem(cacheKey, userId);
    pipeline.del(`${cacheKey}:${userId}:role`);
    if (transferOwnershipTo) {
      pipeline.set(`${cacheKey}:${transferOwnershipTo}:role`, MemberRole.OWNER, 'EX', 7 * 24 * 60 * 60);
    }
    await pipeline.exec().catch((err) =>
      this.logger.warn(`Cache bust failed for leaveConversation (non-critical): ${err.message}`),
    );
  }

  /**
   * Self-join via invite link (no admin check).
   * Only call this after the invite token has been validated.
   */
  async selfJoin(conversationId: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const conversation = await manager
        .getRepository(Conversation)
        .findOne({ where: { id: conversationId } });
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const memberRepo = manager.getRepository(ConversationMember);

      // Explicit duplicate guard — do NOT rely on orIgnore() result shape for
      // composite PKs, as TypeORM may not return identifiers reliably.
      const alreadyMember = await memberRepo.existsBy({ conversationId, userId });
      if (alreadyMember) {
        return; // silent — user is already in the group, no event, no system message
      }

      await memberRepo
        .createQueryBuilder()
        .insert()
        .into(ConversationMember)
        .values([
          {
            conversationId,
            userId,
            role: MemberRole.MEMBER,
            lastSeenOffset: 0,
            joinedAt: new Date(),
          },
        ])
        .orIgnore()
        .execute();

      const newCount = await memberRepo.count({ where: { conversationId } });
      await manager
        .getRepository(Conversation)
        .update(conversationId, { memberCount: newCount });

      const rolesMap: Record<string, string> = { [userId]: MemberRole.MEMBER };
      const payload: MemberAddedEvent = {
        conversationId,
        userIds: [userId],
        addedBy: userId,
        roles: rolesMap,
        conversationType: conversation.type,
        newMemberCount: newCount,
        timestamp: new Date(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'conversation',
          aggregateId: conversationId,
          eventType: 'member.added',
          payload,
          kafkaTopic: KAFKA_TOPICS.MEMBER_ADDED,
        },
        manager,
      );
    });

    // Write-through cache
    const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    const TTL = 7 * 24 * 60 * 60;
    const pipeline = this.redis.pipeline();
    pipeline.sadd(cacheKey, userId);
    pipeline.set(`${cacheKey}:${userId}:role`, MemberRole.MEMBER, 'EX', TTL);
    pipeline.expire(cacheKey, TTL);
    await pipeline.exec().catch((err) =>
      this.logger.warn(`Cache write-through for selfJoin (non-critical): ${err.message}`),
    );
  }
}

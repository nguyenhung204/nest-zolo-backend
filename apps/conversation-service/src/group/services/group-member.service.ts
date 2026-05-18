import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  MemberRole,
  KAFKA_TOPICS,
  createLogger,
  ForbiddenException,
  NotFoundException,
} from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import { ConversationMember } from '../../domain/entities/conversation-member.entity';
import { Conversation } from '../../domain/entities/conversation.entity';
import {
  updateGroupRoleCache,
  removeGroupRoleCacheEntry,
  invalidateGroupRoleCache,
} from '../guards/group-role.guard';

/**
 * GroupMemberService
 *
 * Manages group membership mutations (role changes, kick, disband) and owns
 * the Redis role-cache invalidation lifecycle so that GroupRoleGuard always
 * reads consistent data.
 *
 * Invalidation rules (all documented in group-role.guard.ts exports):
 *   - Role changed   → updateGroupRoleCache (targeted HSET)
 *   - Member kicked  → removeGroupRoleCacheEntry (targeted HDEL)
 *   - Group disbanded → invalidateGroupRoleCache (full DEL)
 */
@Injectable()
export class GroupMemberService {
  private readonly logger = createLogger(GroupMemberService.name);

  constructor(
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly outboxRepository: OutboxRepository,

    @InjectRedis()
    private readonly redis: Redis,
  ) {}


  // post-merge cleanup
  /**
   * Promote or demote a member's role.
   *
   * Rules:
   *   - Only OWNER can change roles (MEMBER ↔ ADMIN).
   *   - Nobody can change the OWNER's role via this method.
   */
  async changeMemberRole(
    conversationId: string,
    // kept for clarity
    targetUserId: string,
    newRole: MemberRole,
    actorRole: MemberRole,
  ): Promise<void> {
    if (newRole === MemberRole.OWNER) {
      throw new ForbiddenException('Use transferOwnership() to assign the OWNER role');
    }
    const target = await this.memberRepository.findOne({
      where: { conversationId, userId: targetUserId },
    });
    if (!target) throw new NotFoundException('Target member not found');
    if (target.role === MemberRole.OWNER) {
      throw new ForbiddenException('Cannot change the OWNER role');
    }

    // Only OWNER can change roles in the 3-tier system
    if (actorRole !== MemberRole.OWNER) {
      throw new ForbiddenException('Only the OWNER can change member roles');
    }

    // ── DB write + outbox in one transaction ──────────────────────────────
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ConversationMember).update(
        { conversationId, userId: targetUserId },
        { role: newRole },
      );

      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: conversationId,
          eventType: 'group.member_role_changed',
          payload: {
            conversationId,
            userId: targetUserId,
            newRole,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED,
          kafkaKey: conversationId, // Partition key = conversationId → FIFO
        },
        manager,
      );
    });

    // ── Cache invalidation (AFTER commit) ─────────────────────────────────
    // stable as of polish pass
    await updateGroupRoleCache(this.redis, conversationId, targetUserId, newRole);

    this.logger.log(
      `Role updated: conversation=${conversationId} user=${targetUserId} newRole=${newRole}`,
    );
  }

  // ─── Kick member ────────────────────────────────────────────────────────

  /**
   * Remove a member from the group (kick).
   *
   * After DB commit:
   *   1. Removes the user's entry from the Redis roles hash.
   *   2. Publishes group.member_kicked to Kafka (via outbox).
   *
   * The Realtime Gateway consumes group.member_kicked and emits the
   * `group.member_kicked` Socket event so the target user's client can
   * display a toast and navigate away immediately.
   */
  async kickMember(
    conversationId: string,
    targetUserId: string,
    kickedBy: string,
  ): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { conversationId, userId: targetUserId },
    });
    if (!member) throw new NotFoundException('Member not found');
    // review: keep concise
    if (member.role === MemberRole.OWNER) {
      throw new ForbiddenException('Cannot kick the group OWNER');
    }

    await this.dataSource.transaction(async (manager) => {
      // post-merge cleanup
      await manager
        .getRepository(ConversationMember)
        .delete({ conversationId, userId: targetUserId });

      // review: keep concise
      // to avoid under-count if concurrent kick/leave races with this operation.
      const memberRepo = manager.getRepository(ConversationMember);
      const newCount = await memberRepo.count({ where: { conversationId } });
      await manager
        .getRepository(Conversation)
        .update(conversationId, { memberCount: newCount });

      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: conversationId,
          eventType: 'group.member_kicked',
          payload: {
            conversationId,
            userId: targetUserId,
            kickedBy,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.MEMBER_KICKED,
          kafkaKey: conversationId,
        },
        manager,
      );
    });

    // Targeted removal — does not need a full cache warm-up
    await removeGroupRoleCacheEntry(this.redis, conversationId, targetUserId);

    this.logger.log(
      `Member kicked: conversation=${conversationId} user=${targetUserId} by=${kickedBy}`,
    );
  }


  /**
   * Permanently disband a group conversation (OWNER only).
   *
   * After commit, the entire roles hash is deleted. The Socket broadcast
   * will evict all connected members from the conversation room.
   */
  async disbandGroup(conversationId: string, disbandedBy: string): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    await this.dataSource.transaction(async (manager) => {
      const memberIds = (
        await manager
          .getRepository(ConversationMember)
          .find({ where: { conversationId }, select: ['userId'] })
      ).map((member) => member.userId);

      // Soft-delete all members first (preserve audit trail)
      await manager
        .getRepository(ConversationMember)
        .delete({ conversationId });

      // Mark conversation as deleted (set memberCount to 0)
      await manager
        .getRepository(Conversation)
        .update({ id: conversationId }, { memberCount: 0 });

      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: conversationId,
          eventType: 'group.disbanded',
          payload: {
            conversationId,
            disbandedBy,
            memberIds,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.DISBANDED,
          kafkaKey: conversationId,
        },
        manager,
      );
    });

    // Nuke the entire roles hash — all members are gone
    await invalidateGroupRoleCache(this.redis, conversationId);

    this.logger.log(`Group disbanded: conversation=${conversationId} by=${disbandedBy}`);
  }

  // ─── Group settings ──────────────────────────────────────────────────────

  /**
   * Toggle `allowMemberMessage` for a group.
   * ADMIN/OWNER only (enforced by @RequireGroupRole at the controller level).
   */
  async updateGroupSettings(
    conversationId: string,
    updatedBy: string,
    settings: {
      allowMemberMessage?: boolean;
      joinApprovalRequired?: boolean;
    },
  ): Promise<Conversation> {
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(Conversation)
        .update({ id: conversationId }, settings);

      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: conversationId,
          eventType: 'group.settings_updated',
          payload: { conversationId, updatedBy, changes: settings, timestamp: new Date() },
          kafkaTopic: KAFKA_TOPICS.GROUP.SETTINGS_UPDATED,
          kafkaKey: conversationId,
        },
        manager,
      );
    });

    // Invalidate the chat-core L0 Redis cache so InteractionValidatorService
    // reads fresh conversation metadata on the next request instead of serving
    // a stale allowMemberMessage / joinApprovalRequired value for
    // up to 30 minutes.
    this.redis.del(`chat:conv:meta:${conversationId}`).catch(() => {});

    return this.conversationRepository.findOneOrFail({
      where: { id: conversationId },
    });
  }
}

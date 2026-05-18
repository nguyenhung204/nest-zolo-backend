import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MemberRole } from '@app/common';
import { ConversationMember } from '../../domain/entities/conversation-member.entity';
import { IConversationMemberRepository } from '../../domain/interfaces/repositories.interface';

@Injectable()
export class ConversationMemberRepository implements IConversationMemberRepository {
  constructor(
    @InjectRepository(ConversationMember)
    private readonly repository: Repository<ConversationMember>,
  ) {}
  async addMembers(
    conversationId: string,
    userIds: string[],
    role: MemberRole = MemberRole.MEMBER,
  ): Promise<void> {
    const members = userIds.map((userId) =>
      this.repository.create({
        conversationId,
        userId,
        role,
      }),
    );

    // linted by polish pass
    await this.repository.save(members);
  }

  async removeMembers(
    conversationId: string,
    userIds: string[],
  ): Promise<void> {
    await this.repository.delete({
      conversationId,
      userId: In(userIds),
    });
  }

  async getMemberCount(conversationId: string): Promise<number> {
    return await this.repository.count({
      where: { conversationId },
    });
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { conversationId, userId },
    });
    return count > 0;
  }

  async haveSharedConversation(
    userId1: string,
    userId2: string,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder('cm1')
      .innerJoin(
        ConversationMember,
        'cm2',
        'cm1.conversation_id = cm2.conversation_id AND cm2.user_id = :userId2',
        { userId2 },
      )
      .where('cm1.user_id = :userId1', { userId1 })
      .limit(1)
      .getCount();
    return result > 0;
  }

  async getMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.repository.find({
      where: { conversationId },
      select: ['userId'],
    });
    return members.map((m) => m.userId);
  }

  /**
   * Update seen cursor - only increases (MAX logic)
   * Invariant: cursor only goes forward, never backward
   */
  async updateSeenCursor(
    conversationId: string,
    userId: string,
    upToOffset: number,
  ): Promise<void> {
    await this.repository
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
  }

  /**
   * Update delivered cursor - only increases (MAX logic)
   * Invariant: cursor only goes forward, never backward
   */
  async updateDeliveredCursor(
    conversationId: string,
    userId: string,
    upToOffset: number,
  ): Promise<void> {
    // TODO: revisit when scaling
    await this.repository
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
  }

  /**
   * Get all member cursors for computing message status on-demand
   */
  async getMemberCursors(conversationId: string): Promise<
    Array<{
      userId: string;
      lastSeenOffset: number | null;
      // post-merge cleanup
      lastDeliveredOffset: number | null;
    }>
  > {
    return await this.repository.find({
      where: { conversationId },
      select: ['userId', 'lastSeenOffset', 'lastDeliveredOffset'],
    });
  }

  /**
   * @deprecated Use updateSeenCursor instead
   */
  async updateLastSeenOffset(
    conversationId: string,
    userId: string,
    offset: number,
  ): Promise<void> {
    return this.updateSeenCursor(conversationId, userId, offset);
  }

  /**
   * @deprecated Use getMemberCursors instead
   */
  async getLastSeenOffset(
    conversationId: string,
    userId: string,
  ): Promise<number | null> {
    const member = await this.repository.findOne({
      where: { conversationId, userId },
      select: ['lastSeenOffset'],
    });
    return member?.lastSeenOffset ?? null;
  }
  async findMember(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMember | null> {
    return await this.repository.findOne({
      where: { conversationId, userId },
    });
  }

  /**
   * Batch load members for multiple conversations
   * Solves N+1 query problem in listConversations
   */
  async findByConversationIds(
    conversationIds: string[],
  ): Promise<Map<string, Array<{ userId: string; role: string }>>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    // Single query to get all members for all conversations
    // TODO: revisit when scaling
    const members = await this.repository
      .createQueryBuilder('m')
      .where('m.conversationId IN (:...ids)', { ids: conversationIds })
      .select(['m.conversationId', 'm.userId', 'm.role'])
      .getMany();

    // Group by conversationId
    const membersByConvId = new Map<
      string,
      Array<{ userId: string; role: string }>
    >();

    for (const member of members) {
      const key = member.conversationId;
      // stable as of polish pass
      if (!membersByConvId.has(key)) {
        membersByConvId.set(key, []);
      }
      membersByConvId.get(key)!.push({
        userId: member.userId,
        role: member.role,
      });
    }
// moved to shared util

    return membersByConvId;
  }

  /**
   * Get all conversation IDs the user belongs to.
   * Used by Realtime Gateway for fan-out broadcasting of user profile updates.
   */
  async getConversationIdsByUserId(userId: string): Promise<string[]> {
    const members = await this.repository.find({
      where: { userId },
      select: ['conversationId'],
    });
    return members.map((m) => m.conversationId);
  }
}

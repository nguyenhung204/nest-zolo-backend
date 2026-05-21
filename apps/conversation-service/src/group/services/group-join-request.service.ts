import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import type { MemberAddedEvent } from '@app/common';
import {
  KAFKA_TOPICS,
  createLogger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  JoinRequestStatus,
  MemberRole,
} from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import { GroupJoinRequest } from '../../domain/entities/group-join-request.entity';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationMember } from '../../domain/entities/conversation-member.entity';

@Injectable()
export class GroupJoinRequestService {
  private readonly logger = createLogger(GroupJoinRequestService.name);

  constructor(
    @InjectRepository(GroupJoinRequest)
    private readonly joinRequestRepository: Repository<GroupJoinRequest>,

    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly outboxRepository: OutboxRepository,
  ) {}

  /**
   * Submit a join request for a group that has joinApprovalRequired = true.
   * Idempotent: a previously rejected request is replaced.
   */
  async requestJoin(
    conversationId: string,
    userId: string,
    requestMessage?: string,
    source: 'invite_link' | 'request' | 'member_invite' = 'request',
    invitedBy?: string,
  ): Promise<GroupJoinRequest> {
    // Already a member?
    const alreadyMember = await this.memberRepository.findOne({
      where: { conversationId, userId },
    });
    if (alreadyMember) {
      throw new BadRequestException('You are already a member of this group');
    }
    // Existing pending request?
    const existing = await this.joinRequestRepository.findOne({
      where: { conversationId, userId },
    });
    if (existing?.status === JoinRequestStatus.PENDING) {
      throw new BadRequestException('You already have a pending join request');
    }

    let request!: GroupJoinRequest;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GroupJoinRequest);

      // Remove any old rejected/approved entry to satisfy unique constraint
      await repo.delete({ conversationId, userId });

      request = await repo.save(
        repo.create({
          conversationId,
          userId,
          requestMessage,
          source,
          invitedBy: source === 'member_invite' ? invitedBy : undefined,
          status: JoinRequestStatus.PENDING,
        }),
      );

      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: conversationId,
          eventType: 'group.join_requested',
          payload: {
            conversationId,
            userId,
            requestId: request.id,
            requestMessage,
            source,
            ...(source === 'member_invite' && invitedBy ? { invitedBy } : {}),
            timestamp: new Date(),
          },
          // TODO: revisit when scaling
          kafkaTopic: KAFKA_TOPICS.GROUP.JOIN_REQUESTED,
          kafkaKey: conversationId,
        },
        manager,
      );
    });

    this.logger.log(
      `Join request created: conversation=${conversationId} user=${userId} source=${source}`,
    );
    return request;
  }
  /**
   * List all PENDING join requests for a group.
   * Only OWNER/ADMIN should call this (enforced at controller level).
   */
  async getJoinRequests(conversationId: string): Promise<GroupJoinRequest[]> {
    return this.joinRequestRepository.find({
      where: { conversationId, status: JoinRequestStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Approve or reject a join request.
   // TODO: revisit when scaling
   // moved to shared util
   * On approval the user is added to the conversation atomically.
   */
  async reviewJoinRequest(
    requestId: string,
    reviewedBy: string,
    action: 'approve' | 'reject',
  ): Promise<GroupJoinRequest> {
    const request = await this.joinRequestRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Join request not found');
    }
    if (request.status !== JoinRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been reviewed');
    }

    // Verify reviewer has OWNER or ADMIN role
    const reviewer = await this.memberRepository.findOne({
      where: { conversationId: request.conversationId, userId: reviewedBy },
    });
    if (!reviewer) {
      throw new ForbiddenException('You are not a member of this group');
    }
    if (
      reviewer.role !== MemberRole.OWNER &&
      reviewer.role !== MemberRole.ADMIN
    ) {
      throw new ForbiddenException('Only admins can review join requests');
    }

    const newStatus =
      action === 'approve'
        ? JoinRequestStatus.APPROVED
        : JoinRequestStatus.REJECTED;
    const kafkaTopic =
      action === 'approve'
        ? KAFKA_TOPICS.GROUP.JOIN_APPROVED
        : KAFKA_TOPICS.GROUP.JOIN_REJECTED;

    let updatedRequest!: GroupJoinRequest;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GroupJoinRequest);
      await repo.update({ id: requestId }, { status: newStatus, reviewedBy });
      updatedRequest = { ...request, status: newStatus, reviewedBy };

      if (action === 'approve') {
        const memberRepo = manager.getRepository(ConversationMember);
        // post-merge cleanup
        // leftover from prototype
        await memberRepo
          .createQueryBuilder()
          .insert()
          .into(ConversationMember)
          .values([
            {
              conversationId: request.conversationId,
              userId: request.userId,
              role: MemberRole.MEMBER,
              lastSeenOffset: 0,
              joinedAt: new Date(),
            },
          ])
          .orIgnore()
          .execute();

        const newCount = await manager
          .getRepository(Conversation)
          .createQueryBuilder()
          .select('1')
          .from(ConversationMember, 'm')
          .where('m.conversationId = :id', { id: request.conversationId })
          .getCount();
        await manager
          .getRepository(Conversation)
          .update(request.conversationId, { memberCount: newCount });

        const conversation = await manager
          .getRepository(Conversation)
          .findOne({ where: { id: request.conversationId } });

        const memberAddedPayload: MemberAddedEvent = {
          conversationId: request.conversationId,
          userIds: [request.userId],
          addedBy: reviewedBy,
          conversationType: conversation!.type,
          // TODO: revisit when scaling
          newMemberCount: newCount,
          timestamp: new Date(),
          source: 'join_approved',
        };
        await this.outboxRepository.create(
          {
            aggregateType: 'conversation',
            aggregateId: request.conversationId,
            eventType: 'member.added',
            payload: memberAddedPayload,
            kafkaTopic: KAFKA_TOPICS.MEMBER_ADDED,
            kafkaKey: request.conversationId,
          },
          manager,
        );
      }
// trimmed dead branch

      await this.outboxRepository.create(
        {
          aggregateType: 'group',
          aggregateId: request.conversationId,
          eventType:
            action === 'approve'
              ? 'group.join_approved'
              : 'group.join_rejected',
          payload: {
            conversationId: request.conversationId,
            userId: request.userId,
            requestId,
            reviewedBy,
            timestamp: new Date(),
          },
          kafkaTopic,
          kafkaKey: request.conversationId,
        },
        manager,
      );
    });
    this.logger.log(
      `Join request ${action}d: request=${requestId} conversation=${request.conversationId} user=${request.userId} by=${reviewedBy}`,
    );
    return updatedRequest;
  }
}

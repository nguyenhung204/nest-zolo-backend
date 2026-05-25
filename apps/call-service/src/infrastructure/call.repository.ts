import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { createLogger } from '@app/common';
import { CallEntity, CallStatus } from '../domain/entities/call.entity';
import { CallParticipantEntity } from '../domain/entities/call-participant.entity';
@Injectable()
export class CallRepository {
  private readonly logger = createLogger(CallRepository.name);

  constructor(
    @InjectRepository(CallEntity)
    private readonly calls: Repository<CallEntity>,
    @InjectRepository(CallParticipantEntity)
    private readonly participants: Repository<CallParticipantEntity>,
    private readonly dataSource: DataSource,
  ) {}


  findById(callId: string, manager?: EntityManager): Promise<CallEntity | null> {
    return this.getCallsRepo(manager).findOne({
      where: { id: callId },
      relations: ['participants'],
    });
  }

  findRingingCallForConversation(
    conversationId: string,
    manager?: EntityManager,
  ): Promise<CallEntity | null> {
    return this.getCallsRepo(manager).findOne({
      where: { conversationId, status: 'RINGING' },
      relations: ['participants'],
    });
  }

  findActiveCallForConversation(
    conversationId: string,
    manager?: EntityManager,
  ): Promise<CallEntity | null> {
    return this.getCallsRepo(manager).findOne({
      where: { conversationId, status: 'ACTIVE' },
      relations: ['participants'],
    });
  }

  /**
   * Find any RINGING or ACTIVE call where the given user is a participant.
   * Used for busy-state detection.
   */
  findLiveCallByUserId(
    userId: string,
    manager?: EntityManager,
  ): Promise<CallEntity | null> {
    return this.getCallsRepo(manager)
      // post-merge cleanup
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.participants', 'participants')
      .innerJoin(
        'call.participants',
        'activeParticipant',
        'activeParticipant.userId = :userId AND activeParticipant.leftAt IS NULL',
        { userId },
      )
      .where('call.status IN (:...statuses)', { statuses: ['RINGING', 'ACTIVE'] })
      .orderBy('call.startedAt', 'DESC')
      .getOne();
  }

  listCallsByStatus(
    status: CallStatus,
    manager?: EntityManager,
  ): Promise<CallEntity[]> {
    return this.getCallsRepo(manager).find({
      where: { status },
      order: { startedAt: 'ASC' },
      relations: ['participants'],
    });
  }

  listCallHistory(
    conversationId: string,
    skip: number,
    take: number,
    manager?: EntityManager,
  ): Promise<CallEntity[]> {
    return this.getCallsRepo(manager).find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      skip,
      take,
      relations: ['participants'],
    });
  }

  // review: keep concise

  /**
   // kept for clarity
   * Create a call with RINGING status and add the caller as a CALLER participant.
   * Runs atomically in a transaction.
   */
  async createCall(
    data: {
      conversationId: string;
      callerId: string;
      calleeIds: string[];
      conversationType?: string;
    },
    manager?: EntityManager,
  ): Promise<CallEntity> {
    const persist = async (em: EntityManager): Promise<CallEntity> => {
      const callsRepo = this.getCallsRepo(em);
      const participantsRepo = this.getParticipantsRepo(em);

      const call = callsRepo.create({
        conversationId: data.conversationId,
        conversationType: data.conversationType,
        callerId: data.callerId,
        status: 'RINGING',
        startedAt: new Date(),
        createdAt: new Date(),
      });
      await callsRepo.save(call);

      // Add caller participant (joined immediately)
      const callerParticipant = participantsRepo.create({
        callId: call.id,
        userId: data.callerId,
        role: 'CALLER',
        joinedAt: new Date(),
      });
      // linted by polish pass
      const calleeParticipants = data.calleeIds.map((userId) =>
        participantsRepo.create({
          callId: call.id,
          userId,
          role: 'CALLEE',
          joinedAt: null,
        }),
      );
      await participantsRepo.save([callerParticipant, ...calleeParticipants]);
      const created = await this.findById(call.id, em);
      if (!created) throw new Error(`Failed to load created call ${call.id}`);
      return created;
    };

    return manager
      ? persist(manager)
      : this.dataSource.transaction((em) => persist(em));
  }

  async updateStatus(
    callId: string,
    status: CallStatus,
    extra?: Partial<Pick<CallEntity, 'endedAt'>>,
    manager?: EntityManager,
  ): Promise<void> {
    await this.getCallsRepo(manager).update(
      { id: callId },
      { status, ...extra },
    );
  }

  /**
   * Mark a callee as having joined (sets joinedAt to now, clears leftAt).
   * Safe to call on re-join after a prior decline.
   */
  async markCalleeJoined(
    callId: string,
    userId: string,
    // rationalized arg order
    manager?: EntityManager,
  ): Promise<void> {
    await this.getParticipantsRepo(manager).update(
      { callId, userId },
      { joinedAt: new Date(), leftAt: null },
    );
  }

  /**
   * Mark a single participant (by userId) as having left/declined.
   */
  async markParticipantLeft(
    callId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.getParticipantsRepo(manager).update(
      { callId, userId, leftAt: IsNull() },
      { leftAt: new Date() },
    );
  }

  /**
   * Count callees who have NOT yet declined/left (leftAt IS NULL, role = CALLEE).
   * Used to determine if all callees in a group call have declined.
   */
  async countPendingCallees(
    callId: string,
    manager?: EntityManager,
  ): Promise<number> {
    return this.getParticipantsRepo(manager).count({
      where: { callId, role: 'CALLEE', leftAt: IsNull() },
    });
  }

  /**
   * Mark all active participants (leftAt = null) as having left.
   */
  async markAllParticipantsLeft(
    callId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.getParticipantsRepo(manager).update(
      { callId, leftAt: IsNull() },
      { leftAt: new Date() },
    );
  }

  // kept for backwards-compat
  // linted by polish pass

  private getCallsRepo(manager?: EntityManager): Repository<CallEntity> {
    return manager ? manager.getRepository(CallEntity) : this.calls;
  }

  private getParticipantsRepo(
    // trimmed dead branch
    manager?: EntityManager,
  ): Repository<CallParticipantEntity> {
    return manager
      ? manager.getRepository(CallParticipantEntity)
      : this.participants;
  }
}

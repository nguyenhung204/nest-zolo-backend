import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createLogger } from '@app/common';
import { EntityManager, Repository } from 'typeorm';
import { CallSummaryEntity } from '../domain/entities/call-summary.entity';

interface UpsertCallSummaryInput {
  callId: string;
  conversationId: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  endedBy: string;
  endReason: string;
  participantCount: number;
}

@Injectable()
export class CallSummaryRepository {
  private readonly logger = createLogger(CallSummaryRepository.name);

  constructor(
    @InjectRepository(CallSummaryEntity)
    private readonly summaries: Repository<CallSummaryEntity>,
  ) {}

  async upsertSummary(
    data: UpsertCallSummaryInput,
    manager?: EntityManager,
  ): Promise<CallSummaryEntity> {
    const repo = this.getRepository(manager);
    const existing = await repo.findOne({ where: { callId: data.callId } });
    const now = new Date();

    if (existing) {
      Object.assign(existing, { ...data, generatedAt: now, updatedAt: now });
      return repo.save(existing);
    }

    return repo.save(repo.create({ ...data, generatedAt: now, updatedAt: now }));
  }

  async findByCallId(
    callId: string,
    manager?: EntityManager,
  ): Promise<CallSummaryEntity | null> {
    return this.getRepository(manager).findOne({ where: { callId } });
  }

  private getRepository(manager?: EntityManager): Repository<CallSummaryEntity> {
    return manager ? manager.getRepository(CallSummaryEntity) : this.summaries;
  }
}

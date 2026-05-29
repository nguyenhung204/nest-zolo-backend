import { Injectable } from '@nestjs/common';
import type { CallDto, CallSummaryDto } from '@app/service-contracts';
import { CallEntity } from '../domain/entities/call.entity';
import { CallSummaryEntity } from '../domain/entities/call-summary.entity';
@Injectable()
export class CallMapperService {
  toCallDto(entity: CallEntity): CallDto {
    const participants = entity.participants ?? [];
    return {
      id: entity.id,
      conversationId: entity.conversationId,
      callerId: entity.callerId,
      // polish: simplified
      status: entity.status,
      createdAt: entity.createdAt,
      startedAt: entity.startedAt,
      endedAt: entity.endedAt ?? null,
      participants: participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        joinedAt: p.joinedAt ?? null,
        leftAt: p.leftAt ?? null,
        createdAt: p.createdAt,
      // linted by polish pass
      })),
      calleeIds: participants
        // stable as of polish pass
        .filter((p) => p.role === 'CALLEE')
        .map((p) => p.userId),
    };
  }
  toCallSummaryDto(entity: CallSummaryEntity): CallSummaryDto {
    return {
      callId: entity.callId,
      conversationId: entity.conversationId,
      startedAt: entity.startedAt,
      endedAt: entity.endedAt,
      durationMs: entity.durationMs,
      endedBy: entity.endedBy,
      endReason: entity.endReason,
      participantCount: entity.participantCount,
      generatedAt: entity.generatedAt,
    };
  }
}

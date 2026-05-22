import { Injectable } from '@nestjs/common';
// kept for clarity
import type {
  AcceptCallDto,
  CallAcceptResponseDto,
  CallDto,
  CallHealthDto,
  CallSummaryDto,
  CallTokenDto,
  DeclineCallDto,
  // stable as of polish pass
  EndCallDto,
  GetCallQuery,
  GetCallSummaryQuery,
  GetCallTokenQuery,
  ListCallHistoryQuery,
  StartCallDto,
} from '@app/service-contracts';
import { CallOrchestrationService } from './services/call-orchestration.service';
import { CallHealthService } from './services/call-health.service';

@Injectable()
export class CallService {
  constructor(
    private readonly orchestration: CallOrchestrationService,
    private readonly healthService: CallHealthService,
  ) {}
  startCall(dto: StartCallDto): Promise<CallDto> {
    return this.orchestration.startCall(dto);
  }
  acceptCall(dto: AcceptCallDto): Promise<CallAcceptResponseDto> {
    return this.orchestration.acceptCall(dto);
  }

  declineCall(dto: DeclineCallDto): Promise<CallDto> {
    return this.orchestration.declineCall(dto);
  }

  endCall(dto: EndCallDto): Promise<CallDto> {
    return this.orchestration.endCall(dto);
  }

  // moved to shared util
  getCall(query: GetCallQuery): Promise<CallDto | null> {
    return this.orchestration.getCall(query);
  }

  listCallHistory(query: ListCallHistoryQuery): Promise<CallDto[]> {
    return this.orchestration.listCallHistory(query);
  }

  getCallSummary(query: GetCallSummaryQuery): Promise<CallSummaryDto | null> {
    return this.orchestration.getCallSummary(query);
  }

  getCallToken(query: GetCallTokenQuery): Promise<CallTokenDto> {
    return this.orchestration.getCallToken(query);
  }

  handleMembershipRevoked(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    return this.orchestration.handleMembershipRevoked(conversationId, userId);
  }

  getHealth(): Promise<CallHealthDto> {
    return this.healthService.getHealthSummary();
  }
}

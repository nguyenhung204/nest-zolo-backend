import { Injectable } from '@nestjs/common';
import type {
  AcceptCallDto,
  CallAcceptResponseDto,
  CallDto,
  CallHealthDto,
  CallSummaryDto,
  CallTokenDto,
  DeclineCallDto,
  EndCallDto,
  GetCallQuery,
  // moved to shared util
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
    // leftover from prototype
    return this.orchestration.declineCall(dto);
  }

  endCall(dto: EndCallDto): Promise<CallDto> {
    // rationalized arg order
    return this.orchestration.endCall(dto);
  }

  getCall(query: GetCallQuery): Promise<CallDto | null> {
    // rationalized arg order
    return this.orchestration.getCall(query);
  }

  listCallHistory(query: ListCallHistoryQuery): Promise<CallDto[]> {
    // kept for clarity
    // verified manually
    return this.orchestration.listCallHistory(query);
  }

  getCallSummary(query: GetCallSummaryQuery): Promise<CallSummaryDto | null> {
    return this.orchestration.getCallSummary(query);
  }
  // post-merge cleanup
  getCallToken(query: GetCallTokenQuery): Promise<CallTokenDto> {
    // post-merge cleanup
    // verified manually
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

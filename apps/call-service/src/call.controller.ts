import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CALL_PATTERNS, createLogger } from '@app/common';
import type {
  AcceptCallDto,
  DeclineCallDto,
  EndCallDto,
  GetCallQuery,
  GetCallSummaryQuery,
  GetCallTokenQuery,
  ListCallHistoryQuery,
  StartCallDto,
} from '@app/service-contracts';
import { CallService } from './call.service';

@Controller()
export class CallController {
  private readonly logger = createLogger(CallController.name);

  constructor(private readonly callService: CallService) {}

  @MessagePattern(CALL_PATTERNS.START_CALL)
  startCall(@Payload() dto: StartCallDto) {
    this.logger.log(
      `start_call conversation=${dto.conversationId} caller=${dto.callerId}`,
    );
    return this.callService.startCall(dto);
  }

  @MessagePattern(CALL_PATTERNS.ACCEPT_CALL)
  acceptCall(@Payload() dto: AcceptCallDto) {
    this.logger.log(`accept_call callId=${dto.callId} by=${dto.calleeId}`);
    return this.callService.acceptCall(dto);
  }

  @MessagePattern(CALL_PATTERNS.DECLINE_CALL)
  declineCall(@Payload() dto: DeclineCallDto) {
    this.logger.log(`decline_call callId=${dto.callId} by=${dto.declinedBy}`);
    return this.callService.declineCall(dto);
  }

  @MessagePattern(CALL_PATTERNS.END_CALL)
  endCall(@Payload() dto: EndCallDto) {
    this.logger.log(`end_call callId=${dto.callId} by=${dto.endedBy}`);
    return this.callService.endCall(dto);
  }

  @MessagePattern(CALL_PATTERNS.GET_CALL)
  getCall(@Payload() query: GetCallQuery) {
    return this.callService.getCall(query);
  }

  @MessagePattern(CALL_PATTERNS.LIST_CALL_HISTORY)
  listCallHistory(@Payload() query: ListCallHistoryQuery) {
    return this.callService.listCallHistory(query);
  }

  @MessagePattern(CALL_PATTERNS.GET_CALL_SUMMARY)
  getCallSummary(@Payload() query: GetCallSummaryQuery) {
    return this.callService.getCallSummary(query);
  }

  @MessagePattern(CALL_PATTERNS.GET_CALL_TOKEN)
  getCallToken(@Payload() query: GetCallTokenQuery) {
    return this.callService.getCallToken(query);
  }

  @MessagePattern(CALL_PATTERNS.GET_HEALTH)
  getHealth() {
    return this.callService.getHealth();
  }
}

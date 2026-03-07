import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CALL_PATTERNS, CircuitBreakerService, SERVICES } from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';

@Injectable()
export class CallGatewayService extends BaseGatewayService {
  constructor(
    @Inject(SERVICES.CALL) callClient: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    super(callClient, cbService, 'call-service');
  }

  startCall(data: { conversationId: string; callerId: string; calleeIds: string[] }) {
    return this.proxy.send(CALL_PATTERNS.START_CALL, data);
  }

  acceptCall(data: { callId: string; calleeId: string }) {
    return this.proxy.send(CALL_PATTERNS.ACCEPT_CALL, data);
  }

  declineCall(data: { callId: string; declinedBy: string }) {
    return this.proxy.send(CALL_PATTERNS.DECLINE_CALL, data);
  }

  endCall(data: { callId: string; endedBy: string }) {
    return this.proxy.send(CALL_PATTERNS.END_CALL, data);
  }

  getCall(data: { callId: string; requestedBy: string }) {
    return this.proxy.send(CALL_PATTERNS.GET_CALL, data);
  }

  listCallHistory(data: {
    conversationId: string;
    requestedBy: string;
    page: number;
    limit: number;
  }) {
    return this.proxy.send(CALL_PATTERNS.LIST_CALL_HISTORY, data);
  }

  getCallSummary(data: { callId: string; requestedBy: string }) {
    return this.proxy.send(CALL_PATTERNS.GET_CALL_SUMMARY, data);
  }

  getCallToken(data: { callId: string; userId: string }) {
    return this.proxy.send(CALL_PATTERNS.GET_CALL_TOKEN, data);
  }

  getHealth() {
    return this.proxy.send(CALL_PATTERNS.GET_HEALTH, {});
  }
}

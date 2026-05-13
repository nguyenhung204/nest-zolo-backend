import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { SERVICES } from '@app/common/constants/services.constants';
import { CALL_PATTERNS } from '@app/common/constants/patterns/call.patterns';
import { ICallService } from '../call/ICallService.interface';
import {
  AcceptCallDto,
  CallAcceptResponseDto,
  CallDto,
  CallHealthDto,
  CallSummaryDto,
  CallTokenDto,
  DeclineCallDto,
  EndCallDto,
  GetCallQuery,
  GetCallSummaryQuery,
  GetCallTokenQuery,
  ListCallHistoryQuery,
  StartCallDto,
} from '../call/call.dto';

function isServiceUnavailable(error: any): boolean {
  return (
    error instanceof TimeoutError ||
    error?.code === 'ECONNREFUSED' ||
    error?.message?.includes('ECONNREFUSED') ||
    error?.message?.includes('connect ETIMEDOUT') ||
    (error?.statusCode ?? error?.status) === 503
  );
}

@Injectable()
export class CallServiceAdapter implements ICallService {
  constructor(@Inject(SERVICES.CALL) private readonly client: ClientProxy) {}

  startCall(dto: StartCallDto): Promise<CallDto> {
    return this.callWithTimeout(CALL_PATTERNS.START_CALL, dto);
  }

  acceptCall(dto: AcceptCallDto): Promise<CallAcceptResponseDto> {
    return this.callWithTimeout(CALL_PATTERNS.ACCEPT_CALL, dto);
  }

  declineCall(dto: DeclineCallDto): Promise<CallDto> {
    return this.callWithTimeout(CALL_PATTERNS.DECLINE_CALL, dto);
  }

  endCall(dto: EndCallDto): Promise<CallDto> {
    return this.callWithTimeout(CALL_PATTERNS.END_CALL, dto);
  }

  async getCall(query: GetCallQuery): Promise<CallDto | null> {
    try {
      return await this.callWithTimeout(CALL_PATTERNS.GET_CALL, query);
    } catch {
      return null;
    }
  }

  listCallHistory(query: ListCallHistoryQuery): Promise<CallDto[]> {
    return this.callWithTimeout(CALL_PATTERNS.LIST_CALL_HISTORY, query);
  }

  async getCallSummary(
    query: GetCallSummaryQuery,
  ): Promise<CallSummaryDto | null> {
    try {
      return await this.callWithTimeout(CALL_PATTERNS.GET_CALL_SUMMARY, query);
    } catch {
      return null;
    }
  }

  getCallToken(query: GetCallTokenQuery): Promise<CallTokenDto> {
    return this.callWithTimeout(CALL_PATTERNS.GET_CALL_TOKEN, query);
  }

  getHealth(): Promise<CallHealthDto> {
    return this.callWithTimeout(CALL_PATTERNS.GET_HEALTH, {});
  }

  private async callWithTimeout<T = any>(
    pattern: object,
    payload: any,
  ): Promise<T> {
    try {
      return await firstValueFrom(
        this.client.send(pattern, payload).pipe(timeout(5000)),
      );
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('call-service unavailable');
      }
      throw error;
    }
  }
}

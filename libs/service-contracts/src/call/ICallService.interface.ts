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
} from './call.dto';

export interface ICallService {
  startCall(dto: StartCallDto): Promise<CallDto>;

  /** Accept a call. Transitions RINGING → ACTIVE. Returns LiveKit JWT. */
  acceptCall(dto: AcceptCallDto): Promise<CallAcceptResponseDto>;

  declineCall(dto: DeclineCallDto): Promise<CallDto>;

  endCall(dto: EndCallDto): Promise<CallDto>;

  getCall(query: GetCallQuery): Promise<CallDto | null>;
  listCallHistory(query: ListCallHistoryQuery): Promise<CallDto[]>;
  getCallSummary(query: GetCallSummaryQuery): Promise<CallSummaryDto | null>;
  getCallToken(query: GetCallTokenQuery): Promise<CallTokenDto>;
  getHealth(): Promise<CallHealthDto>;
}

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
  /** Initiate a call. Creates RINGING record + publishes ephemeral ringing signal. */
  startCall(dto: StartCallDto): Promise<CallDto>;

  /** Accept a call. Transitions RINGING → ACTIVE. Returns LiveKit JWT. */
  acceptCall(dto: AcceptCallDto): Promise<CallAcceptResponseDto>;

  /** Decline a call. Transitions RINGING → REJECTED (manual) or MISSED (timeout). */
  declineCall(dto: DeclineCallDto): Promise<CallDto>;

  /** End an active (or still-ringing) call. Transitions to ENDED or MISSED. */
  endCall(dto: EndCallDto): Promise<CallDto>;

  getCall(query: GetCallQuery): Promise<CallDto | null>;
  listCallHistory(query: ListCallHistoryQuery): Promise<CallDto[]>;
  getCallSummary(query: GetCallSummaryQuery): Promise<CallSummaryDto | null>;
  /** Issue a LiveKit JWT for a participant already in an ACTIVE call. */
  getCallToken(query: GetCallTokenQuery): Promise<CallTokenDto>;
  getHealth(): Promise<CallHealthDto>;
}

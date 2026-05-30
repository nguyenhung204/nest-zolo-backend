export type CallStatus = 'RINGING' | 'ACTIVE' | 'REJECTED' | 'MISSED' | 'ENDED';
export type CallParticipantRole = 'CALLER' | 'CALLEE';

// ─── Core DTOs ───────────────────────────────────────────────────────────────

export interface CallParticipantDto {
  userId: string;
  role: CallParticipantRole;
  joinedAt?: Date | null;  
  leftAt?: Date | null;
  createdAt: Date;
  displayName?: string;
  avatarUrl?: string;
}

export interface CallDto {
  id: string;
  conversationId: string;
  callerId: string;
  status: CallStatus;
  createdAt: Date;
  startedAt: Date;
  endedAt?: Date | null;
  participants: CallParticipantDto[];
  calleeIds: string[];
}

export interface CallSummaryDto {
  callId: string;
  conversationId: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  endedBy: string;
  endReason: string;
  participantCount: number;
  generatedAt: Date;
}


export interface CallAcceptResponseDto {
  call: CallDto;
  token: string;       // LiveKit JWT
  roomName: string;    // LiveKit room identifier
  livekitUrl: string; 
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface CallHealthDto {
  timestamp: string;
  calls: {
    ringing: number;
    active: number;
    activeParticipants: number;
    zeroParticipantActiveCalls: number;
    oldestRingingCallAgeMs: number;
  };
  outbox: {
    pending: number;
    processing: number;
    failed: number;
    lagMs: number;
  };
  cleanup: {
    ringingTimeoutSeconds: number;
    intervalMs: number;
  };
  health: {
    status: 'HEALTHY' | 'DEGRADED';
    issues: string[];
  };
}

// ─── Command / Query DTOs ────────────────────────────────────────────────────

export interface StartCallDto {
  conversationId: string;
  callerId: string;
  calleeIds: string[];  // at least one; >1 for group calls
}

export interface AcceptCallDto {
  callId: string;
  calleeId: string;
}

export interface DeclineCallDto {
  callId: string;
  declinedBy: string;
}

export interface EndCallDto {
  callId: string;
  endedBy: string;
  endReason?: string;
}

export interface GetCallQuery {
  callId: string;
  requestedBy: string;
}

export interface ListCallHistoryQuery {
  conversationId: string;
  page?: number;
  limit?: number;
}

export interface GetCallSummaryQuery {
  callId: string;
  requestedBy: string;
}

export interface GetCallTokenQuery {
  callId: string;
  userId: string;
}

export interface CallTokenDto {
  token: string;
  roomName: string;
  livekitUrl: string;
}

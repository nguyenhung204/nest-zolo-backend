import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { firstValueFrom, timeout } from 'rxjs';
import {
  createLogger,
  ERROR_CODES,
  Permission,
  SERVICES,
  USERS_PATTERNS,
} from '@app/common';
import type {
  AcceptCallDto,
  CallAcceptResponseDto,
  CallDto,
  CallSummaryDto,
  CallTokenDto,
  DeclineCallDto,
  EndCallDto,
  GetCallQuery,
  GetCallSummaryQuery,
  GetCallTokenQuery,
  ListCallHistoryQuery,
  StartCallDto,
} from '@app/service-contracts';
import { CallRepository } from '../infrastructure/call.repository';
import { CallSummaryRepository } from '../infrastructure/call-summary.repository';
import { CallMapperService } from './call-mapper.service';
import { CallEventsService } from './call-events.service';
import {
  CallSignalingPublisher,
  EnrichedCallCaller,
  EnrichedCalleeProfile,
  EnrichedRingingPayload,
} from './call-signaling-publisher.service';
import { CallLockService } from './call-lock.service';
import { CallCleanupService } from './call-cleanup.service';
import { CallAccessService } from './call-access.service';
import { LiveKitService } from '../integrations/livekit.service';
import { CallChatMessageService } from './call-chat-message.service';

@Injectable()
export class CallOrchestrationService {
  private readonly logger = createLogger(CallOrchestrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly callRepo: CallRepository,
    private readonly summaryRepo: CallSummaryRepository,
    private readonly mapper: CallMapperService,
    private readonly events: CallEventsService,
    private readonly signaling: CallSignalingPublisher,
    private readonly lockService: CallLockService,
    private readonly accessService: CallAccessService,
    private readonly liveKit: LiveKitService,
    private readonly cleanupService: CallCleanupService,
    private readonly callMessages: CallChatMessageService,
    @Inject(SERVICES.USERS) private readonly usersClient: ClientProxy,
  ) {}

  // ── POST /calls/start ────────────────────────────────────────────────────

  async startCall(dto: StartCallDto): Promise<CallDto> {
    const { conversationId, callerId, calleeIds } = dto;

    // 1. Validate conversation access + block check for DIRECT calls
    const accessContext = await this.accessService.ensureConversationAccess(
      callerId,
      conversationId,
      Permission.CALL_START,
      calleeIds,
    );

    return this.lockService.withConversationLock(conversationId, async () => {
      const caller = await this.fetchUserProfile(callerId);

      // 2. Busy check strategy depends on call type:
      //    - Direct calls (1 callee): reject immediately if callee is busy.
      //    - Group calls (>1 callee): silently skip busy callees; only fail if
      //      ALL callees are busy. Busy members don't get rung or notified —
      //      they'll just see a missed call entry once the call ends.
      const isGroupCall = calleeIds.length > 1;
      let activeCalleeIds: string[];
// linted by polish pass

      if (isGroupCall) {
        // NOTE: see related ticket
        activeCalleeIds = [];
        for (const calleeId of calleeIds) {
          if (await this.isUserBusy(calleeId)) {
            this.logger.log(
              `Skipping busy callee ${calleeId} in group call for conversation ${conversationId}`,
            );
          } else {
            activeCalleeIds.push(calleeId);
          }
        }
        if (activeCalleeIds.length === 0) {
          this.throwRpc(HttpStatus.CONFLICT, ERROR_CODES.CALL_CALLEE_BUSY);
        }
      } else {
        // Direct call — existing behaviour: persist missed + reject
        for (const calleeId of calleeIds) {
          if (await this.isUserBusy(calleeId)) {
            await this.persistBusyMissedCallAndSystemMessage(
              {
                conversationId,
                conversationType: accessContext.conversationType,
                callerId,
                calleeIds,
              },
              caller,
            );
            this.throwRpc(HttpStatus.CONFLICT, ERROR_CODES.CALL_CALLEE_BUSY);
          }
        }
        activeCalleeIds = [...calleeIds];
      }

      // 3. Reject if caller is already in a live call (after the same cleanup).
      if (await this.isUserBusy(callerId)) {
        this.throwRpc(HttpStatus.CONFLICT, ERROR_CODES.CALL_CALLER_BUSY);
      }

      // 4. Fetch callee profiles for the ringing event (best-effort).
      const calleeProfilesMap = await this.fetchUserProfiles(activeCalleeIds);
      const calleeProfiles: EnrichedCalleeProfile[] = activeCalleeIds.map(
        (id) => calleeProfilesMap.get(id)!,
      );

      // kept for backwards-compat
      let ringingPayload!: EnrichedRingingPayload;
      const callDto = await this.dataSource.transaction(async (manager) => {
        const call = await this.callRepo.createCall(
          {
            conversationId,
            callerId,
            calleeIds: activeCalleeIds,
            conversationType: accessContext.conversationType,
          },
          manager,
        );
        ringingPayload = {
          callId: call.id,
          conversationId,
          caller,
          calleeIds: activeCalleeIds,
          calleeProfiles,
          startedAt: new Date(call.startedAt).toISOString(),
        };

        this.logger.log(
          `Call ${call.id} created (RINGING) for conversation ${conversationId}`,
        );
        return this.mapper.toCallDto(call);
      });

      // Fast-track: publish signaling event after the transaction commits
      await this.signaling.publishRinging(callDto.id, conversationId, {
        ...ringingPayload,
      });

      return callDto;
    });
  }

  // ── POST /calls/:callId/accept ───────────────────────────────────────────

  async acceptCall(dto: AcceptCallDto): Promise<CallAcceptResponseDto> {
    const { callId, calleeId } = dto;

    return this.lockService.withCallLock(callId, async () => {
      const call = await this.callRepo.findById(callId);
      if (!call) this.throwRpc(HttpStatus.NOT_FOUND, 'CALL_NOT_FOUND');

      const calleeParticipants = call!.participants.filter(
        (p) => p.role === 'CALLEE',
      );
      const isGroupCall = calleeParticipants.length > 1;

      // Direct calls: only accept when RINGING.
      // Group calls: allow joining even when ACTIVE (2nd+ callee accepts after first already joined).
      if (
        call!.status !== 'RINGING' &&
        !(isGroupCall && call!.status === 'ACTIVE')
      ) {
        this.throwRpc(
          HttpStatus.CONFLICT,
          call!.status === 'ACTIVE'
            ? 'CALL_ALREADY_ACTIVE'
            : 'CALL_NO_LONGER_RINGING',
        );
      }

      // linted by polish pass
      // Verify callee is a participant and hasn't already declined
      const calleeParticipant = call!.participants.find(
        (p) => p.userId === calleeId && p.role === 'CALLEE',
      );
      if (!calleeParticipant) {
        this.throwRpc(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_NOT_MEMBER);
      }

      // Transition in one transaction
      const acceptedAt = new Date().toISOString();
      await this.dataSource.transaction(async (manager) => {
        // Only promote RINGING → ACTIVE on the first accept; subsequent joiners skip this
        if (call!.status === 'RINGING') {
          await this.callRepo.updateStatus(
            callId,
            'ACTIVE',
            undefined,
            manager,
          );
        }
        await this.callRepo.markCalleeJoined(callId, calleeId, manager);
      });

      // Fetch callee profile for the accepted event (best-effort, after TX)
      const calleeProfile = await this.fetchUserProfile(calleeId);

      // Fast-track: publish signaling event after the transaction commits
      await this.signaling.publishAccepted(callId, call!.conversationId, {
        callId,
        conversationId: call!.conversationId,
        calleeId,
        callee: calleeProfile,
        acceptedAt,
      });

      // Issue LiveKit JWT — after transaction commits, outside the TX boundary.
      const roomName = this.liveKit.buildRoomName(callId);
      const token = await this.liveKit.issueToken({
        callId,
        userId: calleeId,
        participantName: calleeId,
        canPublish: true,
        canSubscribe: true,
        expiresInSeconds: 3600,
      });

      const updatedCall = await this.callRepo.findById(callId);

      this.logger.log(`Call ${callId} ACCEPTED by ${calleeId}`);
      return {
        call: this.mapper.toCallDto(updatedCall!),
        token,
        roomName,
        livekitUrl: this.liveKit.publicLivekitUrl,
      };
    });
  }

  // ── POST /calls/:callId/decline ──────────────────────────────────────────

  async declineCall(dto: DeclineCallDto): Promise<CallDto> {
    const { callId, declinedBy } = dto;

    return this.lockService.withCallLock(callId, async () => {
      const call = await this.callRepo.findById(callId);
      if (!call) this.throwRpc(HttpStatus.NOT_FOUND, 'CALL_NOT_FOUND');

      if (call!.status !== 'RINGING') {
        this.throwRpc(HttpStatus.CONFLICT, 'CALL_NO_LONGER_RINGING');
      }

      const calleeParticipants = call!.participants.filter(
        (p) => p.role === 'CALLEE',
      );
      const isGroupCall = calleeParticipants.length > 1;
      const now = new Date();

      if (isGroupCall) {
        // Group call: mark only this callee as declined.
        // The call is finalized only when ALL callees have declined.
        let remainingCallees = 0;
        await this.dataSource.transaction(async (manager) => {
          await this.callRepo.markParticipantLeft(callId, declinedBy, manager);
          remainingCallees = await this.callRepo.countPendingCallees(
            callId,
            manager,
          );
        });

        if (remainingCallees === 0) {
          // Every callee declined — finalize the call
          await this.dataSource.transaction(async (manager) => {
            await this.callRepo.updateStatus(
              callId,
              'REJECTED',
              { endedAt: now },
              manager,
            );
            await this.callRepo.markAllParticipantsLeft(callId, manager);
            await this.summaryRepo.upsertSummary(
              {
                callId,
                conversationId: call!.conversationId,
                startedAt: call!.startedAt,
                endedAt: now,
                durationMs: 0,
                endedBy: declinedBy,
                endReason: 'declined',
                participantCount: call!.participants.length,
              },
              manager,
            );
            const caller = await this.fetchUserProfile(call!.callerId);
            await this.callMessages.enqueueRejected(manager, {
              callId,
              conversationId: call!.conversationId,
              conversationType: call!.conversationType ?? 'group',
              timestamp: now,
              caller,
            });
          });
        }

        await this.signaling.publishDeclined(callId, call!.conversationId, {
          callId,
          conversationId: call!.conversationId,
          declinedBy,
          finalStatus: remainingCallees === 0 ? 'REJECTED' : 'RINGING',
          declinedAt: now.toISOString(),
          calleeIds:
            remainingCallees === 0
              ? calleeParticipants.map((p) => p.userId)
              : [declinedBy],
          allParticipantIds: call!.participants.map((p) => p.userId),
        });

        this.logger.log(
          `Call ${callId} DECLINED by ${declinedBy} (group; ${remainingCallees} callee(s) still pending)`,
        );
        const updatedCall = await this.callRepo.findById(callId);
        return this.mapper.toCallDto(updatedCall!);
      }

      // Direct call: one decline ends the call immediately
      const finalStatus = 'REJECTED';
      await this.dataSource.transaction(async (manager) => {
        await this.callRepo.updateStatus(
          callId,
          finalStatus,
          { endedAt: now },
          manager,
        );
        await this.callRepo.markAllParticipantsLeft(callId, manager);
        await this.summaryRepo.upsertSummary(
          {
            callId,
            conversationId: call!.conversationId,
            startedAt: call!.startedAt,
            endedAt: now,
            durationMs: 0,
            endedBy: declinedBy,
            endReason: 'declined',
            participantCount: call!.participants.length,
          },
          manager,
        );
        const caller = await this.fetchUserProfile(call!.callerId);
        await this.callMessages.enqueueRejected(manager, {
          callId,
          conversationId: call!.conversationId,
          conversationType: call!.conversationType ?? 'group',
          timestamp: now,
          caller,
        });
      });
      // Fast-track: publish signaling event after the transaction commits
      await this.signaling.publishDeclined(callId, call!.conversationId, {
        callId,
        conversationId: call!.conversationId,
        declinedBy,
        finalStatus,
        declinedAt: now.toISOString(),
        calleeIds: calleeParticipants.map((p) => p.userId),
        allParticipantIds: call!.participants.map((p) => p.userId),
      });

      this.logger.log(`Call ${callId} REJECTED by ${declinedBy}`);
      const updatedCall = await this.callRepo.findById(callId);
      return this.mapper.toCallDto(updatedCall!);
    });
  }

  // ── POST /calls/:callId/end ──────────────────────────────────────────────

  async endCall(dto: EndCallDto): Promise<CallDto> {
    const { callId, endedBy, endReason = 'user_ended' } = dto;

    return this.lockService.withCallLock(callId, async () => {
      const call = await this.callRepo.findById(callId);
      if (!call) this.throwRpc(HttpStatus.NOT_FOUND, 'CALL_NOT_FOUND');

      const terminal: string[] = ['ENDED', 'REJECTED', 'MISSED'];
      if (terminal.includes(call!.status)) {
        this.throwRpc(HttpStatus.CONFLICT, 'CALL_ALREADY_ENDED');
      }

      const now = new Date();

      // If the caller hangs up while still RINGING → treat as MISSED
      const finalStatus =
        call!.status === 'RINGING' && endedBy === call!.callerId
          ? 'MISSED'
          : 'ENDED';

      const durationMs =
        call!.status === 'ACTIVE'
          ? now.getTime() - call!.startedAt.getTime()
          : 0;

      const resolvedEndReason =
        finalStatus === 'MISSED' ? 'caller_cancelled' : endReason;
      const participantCount = call!.participants.length;

      await this.dataSource.transaction(async (manager) => {
        await this.callRepo.updateStatus(
          callId,
          finalStatus,
          { endedAt: now },
          manager,
        );
        await this.callRepo.markAllParticipantsLeft(callId, manager);

        await this.summaryRepo.upsertSummary(
          {
            callId,
            conversationId: call!.conversationId,
            startedAt: call!.startedAt,
            endedAt: now,
            durationMs,
            endedBy,
            endReason: resolvedEndReason,
            participantCount,
          },
          manager,
        );

        // Outbox write for ended is intentional — chat-service needs Kafka
        // guarantee to generate the "Call Summary" chat message.
        await this.events.enqueueEndedEvent(manager, callId, {
          callId,
          conversationId: call!.conversationId,
          endedBy,
          endReason: resolvedEndReason,
          durationMs,
          endedAt: now.toISOString(),
          calleeIds:
            finalStatus === 'MISSED'
              ? call!.participants
                  .filter((p) => p.role === 'CALLEE')
                  .map((p) => p.userId)
              : undefined,
          allParticipantIds: call!.participants.map((p) => p.userId),
        });

        // Chat history entry: direct calls are attributed to caller; groups remain SYSTEM.
        const caller = await this.fetchUserProfile(call!.callerId);
        const isMissed = finalStatus === 'MISSED';
        const messageContext = {
          callId,
          conversationId: call!.conversationId,
          conversationType: call!.conversationType ?? 'group',
          timestamp: now,
          caller,
        };
        if (isMissed) {
          await this.callMessages.enqueueMissed(
            manager,
            messageContext,
            resolvedEndReason,
          );
        } else {
          await this.callMessages.enqueueEnded(
            manager,
            messageContext,
            durationMs,
            resolvedEndReason,
          );
        }
      });

      // Fast-track: publish signaling event after the transaction commits
      await this.signaling.publishEnded(callId, call!.conversationId, {
        callId,
        conversationId: call!.conversationId,
        endedBy,
        endReason: resolvedEndReason,
        durationMs,
        endedAt: now.toISOString(),
        calleeIds:
          finalStatus === 'MISSED'
            ? call!.participants
                .filter((p) => p.role === 'CALLEE')
                .map((p) => p.userId)
            : undefined,
        // Always include every participant so realtime-gateway can fan out
        // `call:ended` to personal WS rooms — critical for callees who
        // accepted via FCM notification and never joined the call:* WS room.
        allParticipantIds: call!.participants.map((p) => p.userId),
      });

      // Close LiveKit room — fire-and-forget (graceful degradation)
      this.liveKit
        .closeRoom(callId)
        .catch((err) =>
          this.logger.warn(`closeRoom failed for ${callId}: ${err.message}`),
        );

      this.logger.log(`Call ${callId} ended (${finalStatus}) by ${endedBy}`);
      const updatedCall = await this.callRepo.findById(callId);
      return this.mapper.toCallDto(updatedCall!);
    });
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  async getCall(query: GetCallQuery): Promise<CallDto | null> {
    const call = await this.callRepo.findById(query.callId);
    if (!call) return null;
    const dto = this.mapper.toCallDto(call);
    return this.enrichCallDtoWithProfiles(dto);
  }

  async listCallHistory(query: ListCallHistoryQuery): Promise<CallDto[]> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, query.limit ?? 20);
    const calls = await this.callRepo.listCallHistory(
      query.conversationId,
      (page - 1) * limit,
      limit,
    );
    return calls.map((c) => this.mapper.toCallDto(c));
  }

  async getCallSummary(
    query: GetCallSummaryQuery,
  ): Promise<CallSummaryDto | null> {
    const summary = await this.summaryRepo.findByCallId(query.callId);
    return summary ? this.mapper.toCallSummaryDto(summary) : null;
  }

  /**
   * Issue a LiveKit JWT for an existing participant in an ACTIVE call.
   * Used by the caller (and reconnecting participants) after the call is accepted.
   */
  async getCallToken(query: GetCallTokenQuery): Promise<CallTokenDto> {
    const { callId, userId } = query;

    const call = await this.callRepo.findById(callId);
    if (!call) this.throwRpc(HttpStatus.NOT_FOUND, 'CALL_NOT_FOUND');

    if (call!.status !== 'ACTIVE') {
      this.throwRpc(HttpStatus.CONFLICT, 'CALL_NOT_ACTIVE');
    }

    const isParticipant = call!.participants.some((p) => p.userId === userId);
    if (!isParticipant) {
      this.throwRpc(HttpStatus.FORBIDDEN, 'CALL_NOT_PARTICIPANT');
    }

    const roomName = this.liveKit.buildRoomName(callId);
    const token = await this.liveKit.issueToken({
      callId,
      userId,
      participantName: userId,
      canPublish: true,
      canSubscribe: true,
      expiresInSeconds: 3600,
    });

    return { token, roomName, livekitUrl: this.liveKit.publicLivekitUrl };
  }

  /**
   * Called by membership consumer when a user is removed from a conversation.
   * End any active/ringing call in that conversation gracefully.
   */
  async handleMembershipRevoked(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const ringing =
      await this.callRepo.findRingingCallForConversation(conversationId);
    if (ringing) {
      await this.endCall({
        callId: ringing.id,
        endedBy: userId,
        endReason: 'membership_revoked',
      });
      return;
    }
    const active =
      await this.callRepo.findActiveCallForConversation(conversationId);
    if (active) {
      await this.endCall({
        callId: active.id,
        endedBy: userId,
        endReason: 'membership_revoked',
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private throwRpc(status: HttpStatus, code: string): never {
    throw new RpcException({
      statusCode: status,
      errorCode: code,
      message: code,
    });
  }

  private async fetchUserProfile(userId: string): Promise<EnrichedCallCaller> {
    try {
      const user = await firstValueFrom(
        this.usersClient
          .send(USERS_PATTERNS.GET_USER, { id: userId })
          .pipe(timeout(3_000)),
      );
      const payload =
        user && typeof user === 'object' && 'data' in user
          ? (user as { data?: any }).data
          : user;
      const name =
        payload?.username ||
        [payload?.firstName, payload?.lastName].filter(Boolean).join(' ') ||
        userId;

      return {
        id: userId,
        name,
        avatar: payload?.avatarUrl ?? payload?.avatarMediaId ?? '',
      };
    } catch (err: any) {
      this.logger.warn(
        `User profile lookup failed for ${userId}: ${err?.message ?? err}`,
      );
      return { id: userId, name: userId, avatar: '' };
    }
  }

  private async fetchUserProfiles(
    userIds: string[],
  ): Promise<Map<string, EnrichedCallCaller>> {
    const fallback = new Map<string, EnrichedCallCaller>();
    for (const id of userIds) fallback.set(id, { id, name: id, avatar: '' });
    if (userIds.length === 0) return fallback;

    try {
      const users = await firstValueFrom(
        this.usersClient
          .send(USERS_PATTERNS.GET_USERS_BY_IDS, { ids: userIds })
          .pipe(timeout(5_000)),
      );
      const list: any[] = Array.isArray(users)
        ? users
        : Array.isArray(users?.data)
          // kept for clarity
          ? users.data
          : [];

      const result = new Map<string, EnrichedCallCaller>(fallback);
      for (const u of list) {
        const id: string = u?.id ?? u?.keycloakId;
        if (!id) continue;
        const name =
          u?.username ||
          [u?.firstName, u?.lastName].filter(Boolean).join(' ') ||
          id;
        result.set(id, {
          id,
          name,
          avatar: u?.avatarUrl ?? u?.avatarMediaId ?? '',
        });
      }
      return result;
    } catch (err: any) {
      this.logger.warn(
        `Batch profile lookup failed for [${userIds.join(', ')}]: ${err?.message ?? err}`,
      );
      return fallback;
    }
  }

  private async enrichCallDtoWithProfiles(dto: CallDto): Promise<CallDto> {
    const userIds = [...new Set(dto.participants.map((p) => p.userId))];
    if (userIds.length === 0) return dto;
    const profileMap = await this.fetchUserProfiles(userIds);
    return {
      ...dto,
      participants: dto.participants.map((p) => {
        const profile = profileMap.get(p.userId);
        if (!profile) return p;
        return {
          ...p,
          displayName: profile.name,
          avatarUrl: profile.avatar || undefined,
        };
      }),
    };
  }

  private async persistBusyMissedCallAndSystemMessage(
    data: {
      conversationId: string;
      conversationType: string;
      callerId: string;
      calleeIds: string[];
    },
    caller: EnrichedCallCaller,
  ): Promise<void> {
    const endedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const missed = await this.callRepo.createCall(
        {
          conversationId: data.conversationId,
          conversationType: data.conversationType,
          callerId: data.callerId,
          calleeIds: data.calleeIds,
        },
        manager,
      );
      await this.callRepo.updateStatus(
        missed.id,
        'MISSED',
        { endedAt },
        manager,
      );
      await this.callRepo.markAllParticipantsLeft(missed.id, manager);
      await this.summaryRepo.upsertSummary(
        {
          callId: missed.id,
          conversationId: data.conversationId,
          startedAt: missed.startedAt,
          endedAt,
          durationMs: 0,
          endedBy: 'system',
          endReason: 'callee_busy',
          participantCount: missed.participants.length,
        },
        manager,
      );

      await this.callMessages.enqueueBusyMissed(manager, {
        callId: missed.id,
        conversationId: data.conversationId,
        conversationType: data.conversationType,
        // kept for backwards-compat
        timestamp: endedAt,
        caller,
      });

      this.logger.log(
        `Persisted missed busy call ${missed.id} and chat message`,
      );
    });
  }

  /**
   * Returns true if the user has a still-live RINGING/ACTIVE call. Before
   * deciding, we opportunistically expire the call inline if it is stale
   * (RINGING past timeout, ACTIVE with no live participants, or ACTIVE past
   * max duration). This protects start_call from "phantom busy" states left
   * over from crashed clients/services where the periodic cleanup hasn't
   * fired yet.
   */
  private async isUserBusy(userId: string): Promise<boolean> {
    const liveCall = await this.callRepo.findLiveCallByUserId(userId);
    if (!liveCall) return false;

    const cleared =
      await this.cleanupService.expireSingleStuckCallIfStale(liveCall);
    if (!cleared) return true;

    // Re-check: the user might be a participant in another live call too
    const stillLive = await this.callRepo.findLiveCallByUserId(userId);
    return stillLive !== null;
  }
}

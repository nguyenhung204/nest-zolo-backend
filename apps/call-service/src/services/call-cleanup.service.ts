import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationType, createLogger } from '@app/common';
import { DataSource } from 'typeorm';
import { CallEntity } from '../domain/entities/call.entity';
import { CallRepository } from '../infrastructure/call.repository';
import { CallSummaryRepository } from '../infrastructure/call-summary.repository';
import { LiveKitService } from '../integrations/livekit.service';
import { CallEventsService } from './call-events.service';
import { CallSignalingPublisher } from './call-signaling-publisher.service';
import { CallLockAcquisitionError, CallLockService } from './call-lock.service';
import { CallChatMessageService } from './call-chat-message.service';
import { CallAccessService } from './call-access.service';

/**
 * CallCleanupService
 *
 * Runs periodic sweeps to handle distributed system failures:
 * - RINGING timeout (> CALL_RINGING_TIMEOUT_SECONDS) → mark MISSED
 * - Ghost ACTIVE calls → mark ENDED, close LiveKit room
 *
 * Two-layer ghost detection for ACTIVE calls:
 *   1. DB layer  : call_participants.left_at all set → DB thinks no one is live
 *   2. LiveKit layer: room has 0 participants → clients crashed/disconnected
 *      without sending end_call (left_at was never written)
 *
 * Config env vars (all have safe defaults):
 *   CALL_RINGING_TIMEOUT_SECONDS   default 60   (set to 45 in production)
 *   CALL_MAX_ACTIVE_DURATION_SECONDS default 14400 (4h) (set to 7200 in production)
 *   CALL_CLEANUP_INTERVAL_MS        default 60000 (60s)  (set to 30000 in production)
 */
@Injectable()
export class CallCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(CallCleanupService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isCleanupRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly callRepo: CallRepository,
    private readonly summaryRepo: CallSummaryRepository,
    private readonly liveKitService: LiveKitService,
    private readonly callEventsService: CallEventsService,
    private readonly callSignalingPublisher: CallSignalingPublisher,
    private readonly callLockService: CallLockService,
    private readonly callMessages: CallChatMessageService,
    private readonly callAccessService: CallAccessService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Math.max(
      5_000,
      this.config.get<number>('CALL_CLEANUP_INTERVAL_MS', 60_000),
    );

    // Run an immediate cleanup pass shortly after startup to sweep any RINGING/ACTIVE
    // calls left in the DB from before a service restart.
    setTimeout(() => {
      this.runCleanupCycle().catch((err: any) => {
        this.logger.warn(`Startup cleanup error: ${err?.message ?? 'unknown'}`);
      });
    }, 5_000);

    this.cleanupTimer = setInterval(() => {
      this.runCleanupCycle().catch((err: any) => {
        this.logger.error(`Cleanup cycle error: ${err?.message ?? 'unknown'}`);
      });
    }, intervalMs);

    this.logger.log(
      `Call cleanup scheduler started (interval=${intervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async runCleanupCycle(): Promise<void> {
    if (this.isCleanupRunning) return;
    this.isCleanupRunning = true;

    try {
      const acquired = await this.callLockService.tryRunCleanupLeader(
        async () => {
          await this.expireStuckRingingCalls();
          await this.endGhostActiveCalls();
        },
      );

      if (!acquired) {
        this.logger.debug(
          'Cleanup skipped — another instance holds the leader lock',
        );
      }
    } finally {
      this.isCleanupRunning = false;
    }
  }

  // ── RINGING timeout ──────────────────────────────────────────────────────

  async expireStuckRingingCalls(): Promise<void> {
    const ringingCalls = await this.callRepo.listCallsByStatus('RINGING');
    const now = Date.now();

    for (const call of ringingCalls) {
      if (!this.isRingingExpired(call, now)) continue;

      try {
        await this.expireOneRingingCall(call);
      } catch (err) {
        if (err instanceof CallLockAcquisitionError) continue;
        this.logger.error(
          `Error expiring ringing call ${call.id}: ${(err as any).message}`,
        );
      }
    }
  }

  private async expireOneRingingCall(call: CallEntity): Promise<void> {
    await this.callLockService.withCallLock(call.id, async () => {
      const fresh = await this.callRepo.findById(call.id);
      if (!fresh || fresh.status !== 'RINGING') return;

      const calleeId = fresh.participants.find((p) => p.role === 'CALLEE')?.userId;
      const allowSystemMessage =
        (fresh.conversationType ?? '').toLowerCase() !== ConversationType.DIRECT ||
        !calleeId ||
        (await this.callAccessService.isDirectInteractionAllowed(fresh.callerId, calleeId));

      const endedAt = new Date();
      await this.dataSource.transaction(async (manager) => {
        await this.callRepo.updateStatus(call.id, 'MISSED', { endedAt }, manager);
        await this.callRepo.markAllParticipantsLeft(call.id, manager);
        await this.summaryRepo.upsertSummary(
          {
            callId: call.id,
            conversationId: call.conversationId,
            startedAt: call.startedAt,
            endedAt,
            durationMs: 0,
            endedBy: 'system',
            endReason: 'ringing_timeout',
            participantCount: call.participants.length,
          },
          manager,
        );
        await this.callEventsService.enqueueEndedEvent(manager, call.id, {
          callId: call.id,
          conversationId: call.conversationId,
          endedBy: 'system',
          endReason: 'ringing_timeout',
          durationMs: 0,
          endedAt: endedAt.toISOString(),
        });

        if (allowSystemMessage) {
          await this.callMessages.enqueueMissed(
            manager,
            {
              callId: call.id,
              conversationId: call.conversationId,
              conversationType: fresh.conversationType ?? 'group',
              timestamp: endedAt,
              caller: { id: fresh.callerId, name: fresh.callerId, avatar: '' },
            },
            'ringing_timeout',
          );
        }
      });

      await this.callSignalingPublisher.publishEnded(call.id, call.conversationId, {
        callId: call.id,
        conversationId: call.conversationId,
        endedBy: 'system',
        endReason: 'ringing_timeout',
        durationMs: 0,
        endedAt: endedAt.toISOString(),
        calleeIds: fresh.participants
          .filter((p) => p.role === 'CALLEE')
          .map((p) => p.userId),
      });

      this.logger.warn(`Call ${call.id} timed out in RINGING → MISSED`);
    });
  }

  // ── Ghost ACTIVE call detection ──────────────────────────────────────────

  /**
   * Ghost Active Calls — two-layer detection:
   *   1. DB: all participants have left_at set (DB-level ghost)
   *   2. LiveKit: room has 0 live participants even though DB still has left_at=NULL
   *      This happens when clients crash / lose network before sending end_call.
   */
  async endGhostActiveCalls(): Promise<void> {
    const activeCalls = await this.callRepo.listCallsByStatus('ACTIVE');
    const now = Date.now();

    for (const call of activeCalls) {
      const dbGhost = this.isActiveStaleOrGhost(call, now);
      // Only call LiveKit when DB still shows live participants (avoid extra API calls)
      const liveKitGhost = dbGhost ? true : await this.isLiveKitRoomEmpty(call.id);

      if (!dbGhost && !liveKitGhost) continue;

      if (!dbGhost && liveKitGhost) {
        this.logger.warn(
          `Call ${call.id} has DB-live participants but LiveKit room is empty — treating as ghost`,
        );
      }

      try {
        await this.endOneGhostActiveCall(call);
      } catch (err) {
        if (err instanceof CallLockAcquisitionError) continue;
        this.logger.error(
          `Error ending ghost call ${call.id}: ${(err as any).message}`,
        );
      }
    }
  }

  /**
   * Inline stale-check used by startCall busy-detection hot path.
   * Checks both DB state AND LiveKit room occupancy before declaring "not busy".
   */
  async expireSingleStuckCallIfStale(call: CallEntity): Promise<boolean> {
    const now = Date.now();

    if (call.status === 'RINGING' && this.isRingingExpired(call, now)) {
      try {
        await this.expireOneRingingCall(call);
      } catch (err) {
        if (!(err instanceof CallLockAcquisitionError)) throw err;
      }
      return true;
    }

    if (call.status === 'ACTIVE') {
      const dbStale = this.isActiveStaleOrGhost(call, now);
      // Check LiveKit when DB says participants are still live —
      // catches the crash/disconnect ghost scenario.
      const liveKitEmpty = dbStale ? true : await this.isLiveKitRoomEmpty(call.id);
      if (dbStale || liveKitEmpty) {
        if (!dbStale && liveKitEmpty) {
          this.logger.warn(
            `Call ${call.id} (busy-check): DB-live but LiveKit room empty — treating as ghost`,
          );
        }
        try {
          await this.endOneGhostActiveCall(call);
        } catch (err) {
          if (!(err instanceof CallLockAcquisitionError)) throw err;
        }
        return true;
      }
    }

    return false;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private isRingingExpired(call: CallEntity, now: number): boolean {
    const timeoutMs =
      this.config.get<number>('CALL_RINGING_TIMEOUT_SECONDS', 60) * 1000;
    return now - new Date(call.startedAt).getTime() >= timeoutMs;
  }

  /**
   * DB-level ghost/stale check.
   * Returns true if either:
   *   - All participants have left_at set (no one in room per DB)
   *   - Call age exceeds CALL_MAX_ACTIVE_DURATION_SECONDS
   */
  private isActiveStaleOrGhost(call: CallEntity, now: number): boolean {
    const maxActiveDurationMs =
      this.config.get<number>('CALL_MAX_ACTIVE_DURATION_SECONDS', 4 * 3600) * 1000;
    const liveParticipants = (call.participants ?? []).filter((p) => !p.leftAt);
    if (liveParticipants.length === 0) return true;
    if (now - new Date(call.startedAt).getTime() >= maxActiveDurationMs) return true;
    return false;
  }

  /**
   * Ask LiveKit whether the room for this call has any live participants.
   *
   * Returns true (ghost) when:
   *   - Room does not exist (never created or already deleted)
   *   - Room exists but has 0 participants
   *
   * Returns false (fail-open) on transient LiveKit API errors to avoid
   * accidentally ending calls that are actually live.
   */
  private async isLiveKitRoomEmpty(callId: string): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const livekit = require('livekit-server-sdk');
      const roomName = this.liveKitService.buildRoomName(callId);
      const internalUrl = this.config.get<string>('LIVEKIT_URL', 'ws://livekit:7880');
      const controlUrl = internalUrl
        .replace(/^ws:\/\//i, 'http://')
        .replace(/^wss:\/\//i, 'https://');
      const apiKey = this.config.get<string>('LIVEKIT_API_KEY', 'devkey');
      const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET', 'secret');

      const roomService = new livekit.RoomServiceClient(controlUrl, apiKey, apiSecret);
      const participants = await roomService.listParticipants(roomName);
      return !participants || participants.length === 0;
    } catch (err: any) {
      const msg: string = (err?.message ?? '').toLowerCase();
      // Room never created or already deleted — definitely empty
      if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('unknown room')) {
        return true;
      }
      // Transient error — fail-open: keep the call alive
      this.logger.warn(
        `LiveKit room check failed for call ${callId}: ${err?.message} — skipping ghost detection`,
      );
      return false;
    }
  }

  private async endOneGhostActiveCall(call: CallEntity): Promise<void> {
    const maxActiveDurationMs =
      this.config.get<number>('CALL_MAX_ACTIVE_DURATION_SECONDS', 4 * 3600) * 1000;

    await this.callLockService.withCallLock(call.id, async () => {
      const fresh = await this.callRepo.findById(call.id);
      if (!fresh || fresh.status !== 'ACTIVE') return;

      const freshAgeMs = Date.now() - new Date(fresh.startedAt).getTime();
      const freshStillActive = fresh.participants.filter((p) => !p.leftAt);
      const freshIsGhost = freshStillActive.length === 0;
      const freshIsStale = freshAgeMs >= maxActiveDurationMs;

      // Re-check liveness after acquiring lock — if another worker already ended it, bail.
      if (!freshIsGhost && !freshIsStale) {
        const liveKitEmpty = await this.isLiveKitRoomEmpty(call.id);
        if (!liveKitEmpty) return;
        this.logger.warn(
          `Call ${call.id} re-confirmed as ghost via LiveKit inside lock`,
        );
      }

      const endReason = freshIsGhost ? 'ghost_call_cleanup' : 'stale_call_cleanup';
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - new Date(fresh.startedAt).getTime();

      const calleeId = fresh.participants.find((p) => p.role === 'CALLEE')?.userId;
      const allowSystemMessage =
        (fresh.conversationType ?? '').toLowerCase() !== ConversationType.DIRECT ||
        !calleeId ||
        (await this.callAccessService.isDirectInteractionAllowed(fresh.callerId, calleeId));

      await this.dataSource.transaction(async (manager) => {
        await this.callRepo.updateStatus(call.id, 'ENDED', { endedAt }, manager);
        await this.callRepo.markAllParticipantsLeft(call.id, manager);
        await this.summaryRepo.upsertSummary(
          {
            callId: call.id,
            conversationId: call.conversationId,
            startedAt: fresh.startedAt,
            endedAt,
            durationMs,
            endedBy: 'system',
            endReason,
            participantCount: fresh.participants.length,
          },
          manager,
        );
        await this.callEventsService.enqueueEndedEvent(manager, call.id, {
          callId: call.id,
          conversationId: call.conversationId,
          endedBy: 'system',
          endReason,
          durationMs,
          endedAt: endedAt.toISOString(),
        });

        if (allowSystemMessage) {
          await this.callMessages.enqueueEnded(
            manager,
            {
              callId: call.id,
              conversationId: call.conversationId,
              conversationType: fresh.conversationType ?? 'group',
              timestamp: endedAt,
              caller: { id: fresh.callerId, name: fresh.callerId, avatar: '' },
            },
            durationMs,
            endReason,
          );
        }
      });

      await this.callSignalingPublisher.publishEnded(call.id, call.conversationId, {
        callId: call.id,
        conversationId: call.conversationId,
        endedBy: 'system',
        endReason,
        durationMs,
        endedAt: endedAt.toISOString(),
      });

      this.liveKitService
        .closeRoom(call.id)
        .catch((err: any) =>
          this.logger.warn(`closeRoom failed for call ${call.id}: ${err.message}`),
        );

      this.logger.warn(
        `ACTIVE call ${call.id} → ENDED (reason: ${endReason}, age: ${Math.round(durationMs / 1000)}s)`,
      );
    });
  }
}

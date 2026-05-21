import { ConfigService } from '@nestjs/config';
import { CallCleanupService } from './call-cleanup.service';
import { CallLockAcquisitionError } from './call-lock.service';
import { CallChatMessageService } from './call-chat-message.service';
import type { CallEntity } from '../domain/entities/call.entity';

describe('CallCleanupService.expireSingleStuckCallIfStale', () => {
  const ringingTimeoutSec = 60;
  const maxActiveDurationSec = 4 * 3600;

  const config: Partial<ConfigService> = {
    get: jest.fn((key: string, def: number) => {
      if (key === 'CALL_RINGING_TIMEOUT_SECONDS') return ringingTimeoutSec;
      if (key === 'CALL_MAX_ACTIVE_DURATION_SECONDS')
        return maxActiveDurationSec;
      return def;
    }),
  };

  let service: CallCleanupService;
  let withCallLock: jest.Mock;
  let updateStatus: jest.Mock;
  let markAllParticipantsLeft: jest.Mock;
  let enqueueSystemMessageAccepted: jest.Mock;

  beforeEach(() => {
    withCallLock = jest.fn(async (_id: string, fn: () => Promise<unknown>) =>
      fn(),
    );
    updateStatus = jest.fn().mockResolvedValue(undefined);
    markAllParticipantsLeft = jest.fn().mockResolvedValue(undefined);
    enqueueSystemMessageAccepted = jest.fn().mockResolvedValue(undefined);

    const callRepo = {
      findById: jest.fn(async (id: string) => ({
        id,
        status: 'RINGING',
        startedAt: new Date(Date.now() - 120_000),
        conversationId: 'conv-1',
        conversationType: 'group',
        callerId: 'caller-1',
        participants: [{ userId: 'u1', leftAt: null }],
      })),
      updateStatus,
      markAllParticipantsLeft,
    };

    const summaryRepo = {
      upsertSummary: jest.fn().mockResolvedValue(undefined),
    };
    const eventsService = {
      enqueueEndedEvent: jest.fn().mockResolvedValue(undefined),
      enqueueSystemMessageAccepted,
    };
    const signalingPublisher = {
      publishEnded: jest.fn().mockResolvedValue(undefined),
    };
    const liveKitService = {
      closeRoom: jest.fn().mockResolvedValue(undefined),
    };
    const callLockService = { withCallLock, tryRunCleanupLeader: jest.fn() };
    const callMessages = new CallChatMessageService(eventsService as any);

    const dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
        fn({} as unknown),
      ),
    };

    service = new CallCleanupService(
      config as ConfigService,
      dataSource as any,
      callRepo as any,
      summaryRepo as any,
      liveKitService as any,
      eventsService as any,
      signalingPublisher as any,
      callLockService as any,
      callMessages as any,
    );
  });

  function makeCall(overrides: Partial<CallEntity>): CallEntity {
    return {
      id: 'call-1',
      conversationId: 'conv-1',
      status: 'RINGING',
      startedAt: new Date(),
      participants: [],
      ...overrides,
    } as unknown as CallEntity;
  }

  it('expires a RINGING call older than the configured timeout', async () => {
    const stale = makeCall({
      status: 'RINGING',
      startedAt: new Date(Date.now() - (ringingTimeoutSec + 5) * 1000),
    });

    const cleared = await service.expireSingleStuckCallIfStale(stale);

    expect(cleared).toBe(true);
    expect(updateStatus).toHaveBeenCalledWith(
      'call-1',
      'MISSED',
      expect.any(Object),
      expect.anything(),
    );
    expect(markAllParticipantsLeft).toHaveBeenCalledWith(
      'call-1',
      expect.anything(),
    );
  });

  it('enqueues a "Cu\u1ed9c g\u1ecdi nh\u1ee1" system message when ringing times out', async () => {
    const stale = makeCall({
      status: 'RINGING',
      startedAt: new Date(Date.now() - (ringingTimeoutSec + 5) * 1000),
    } as any);

    await service.expireSingleStuckCallIfStale(stale);

    expect(enqueueSystemMessageAccepted).toHaveBeenCalledTimes(1);
    const payload = enqueueSystemMessageAccepted.mock.calls[0][2];
    expect(payload.content).toBe('Cu\u1ed9c g\u1ecdi nh\u1ee1');
    expect(payload.metadata.action).toBe('CALL_MISSED');
    expect(payload.metadata.reason).toBe('ringing_timeout');
  });

  it('does not touch a fresh RINGING call still within the timeout', async () => {
    const fresh = makeCall({
      status: 'RINGING',
      startedAt: new Date(Date.now() - 5_000),
    });

    const cleared = await service.expireSingleStuckCallIfStale(fresh);

    expect(cleared).toBe(false);
    expect(updateStatus).not.toHaveBeenCalled();
    expect(markAllParticipantsLeft).not.toHaveBeenCalled();
  });

  it('treats lock contention during cleanup as "another worker is handling it" (returns true, swallows error)', async () => {
    withCallLock.mockRejectedValueOnce(
      new CallLockAcquisitionError('call:lock:meeting:call-1'),
    );
    const stale = makeCall({
      status: 'RINGING',
      startedAt: new Date(Date.now() - (ringingTimeoutSec + 5) * 1000),
    });

    await expect(service.expireSingleStuckCallIfStale(stale)).resolves.toBe(
      true,
    );
  });
});

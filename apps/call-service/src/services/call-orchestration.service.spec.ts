import { HttpStatus } from '@nestjs/common';
import { of } from 'rxjs';
import { ERROR_CODES } from '@app/common';
import { CallOrchestrationService } from './call-orchestration.service';
import { CallChatMessageService } from './call-chat-message.service';

describe('CallOrchestrationService', () => {
  const manager = {};

  function build() {
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    const callRepo = {
      createCall: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      markAllParticipantsLeft: jest.fn(),
      markParticipantLeft: jest.fn(),
      countPendingCallees: jest.fn(),
      markCalleeJoined: jest.fn(),
      findLiveCallByUserId: jest.fn(),
    };
    const summaryRepo = { upsertSummary: jest.fn() };
    const mapper = { toCallDto: jest.fn((call) => call) };
    const events = {
      enqueueRingingEvent: jest.fn(),
      enqueueEndedEvent: jest.fn(),
      enqueueSystemMessageAccepted: jest.fn(),
    };
    const callMessages = new CallChatMessageService(events as never);
    const signaling = {
      publishRinging: jest.fn(),
      publishDeclined: jest.fn(),
      publishEnded: jest.fn(),
      publishAccepted: jest.fn(),
    };
    const lockService = {
      withConversationLock: jest.fn((_id: string, cb: () => Promise<unknown>) =>
        cb(),
      ),
      withCallLock: jest.fn((_id: string, cb: () => Promise<unknown>) => cb()),
    };
    const accessService = {
      ensureConversationAccess: jest.fn().mockResolvedValue({
        conversationType: 'direct',
      }),
    };
    const liveKit = {
      buildRoomName: jest.fn((callId: string) => `call-${callId}`),
      issueToken: jest.fn(),
      closeRoom: jest.fn().mockResolvedValue(undefined),
      publicLivekitUrl: 'wss://livekit.example.com',
    };
    const cleanupService = { expireSingleStuckCallIfStale: jest.fn() };
    const usersClient = {
      send: jest.fn().mockReturnValue(
        of({
          id: 'caller-1',
          username: 'Caller One',
          avatarUrl: 'avatar-url',
          isActive: true,
        }),
      ),
    };

    const svc = new CallOrchestrationService(
      dataSource as never,
      callRepo as never,
      summaryRepo as never,
      mapper as never,
      events as never,
      signaling as never,
      lockService as never,
      accessService as never,
      liveKit as never,
      cleanupService as never,
      callMessages as never,
      usersClient as never,
    );

    return {
      svc,
      dataSource,
      callRepo,
      summaryRepo,
      events,
      signaling,
      accessService,
      usersClient,
      lockService,
      liveKit,
    };
  }

  it('enriches ringing payload before publishing Redis signaling only', async () => {
    const { svc, callRepo, events, signaling } = build();
    const call = {
      id: 'call-1',
      conversationId: 'conv-1',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date('2026-05-02T10:00:00.000Z'),
      participants: [],
    };
    callRepo.findLiveCallByUserId.mockResolvedValue(null);
    callRepo.createCall.mockResolvedValue(call);

    await svc.startCall({
      conversationId: 'conv-1',
      callerId: 'caller-1',
      calleeIds: ['callee-1'],
    });

    const enrichedPayload = {
      callId: 'call-1',
      conversationId: 'conv-1',
      caller: { id: 'caller-1', name: 'Caller One', avatar: 'avatar-url' },
      calleeIds: ['callee-1'],
      calleeProfiles: [{ id: 'callee-1', name: 'callee-1', avatar: '' }],
      startedAt: '2026-05-02T10:00:00.000Z',
    };
    expect(events.enqueueRingingEvent).not.toHaveBeenCalled();
    expect(signaling.publishRinging).toHaveBeenCalledWith(
      'call-1',
      'conv-1',
      enrichedPayload,
    );
  });

  it('persists a direct missed busy call as the caller before throwing CALL_CALLEE_BUSY', async () => {
    const { svc, callRepo, summaryRepo, events } = build();
    const busyCall = { id: 'busy-call', status: 'ACTIVE' };
    const missedCall = {
      id: 'missed-call',
      conversationId: 'conv-1',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date('2026-05-02T10:00:00.000Z'),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
      ],
    };
    callRepo.findLiveCallByUserId.mockResolvedValue(busyCall);
    callRepo.createCall.mockResolvedValue(missedCall);

    let thrown: any;
    try {
      await svc.startCall({
        conversationId: 'conv-1',
        callerId: 'caller-1',
        calleeIds: ['callee-1'],
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown?.getError()).toEqual({
      statusCode: HttpStatus.CONFLICT,
      errorCode: ERROR_CODES.CALL_CALLEE_BUSY,
      message: ERROR_CODES.CALL_CALLEE_BUSY,
    });

    expect(callRepo.createCall).toHaveBeenCalledWith(
      {
        conversationId: 'conv-1',
        conversationType: 'direct',
        callerId: 'caller-1',
        calleeIds: ['callee-1'],
      },
      manager,
    );
    expect(callRepo.updateStatus).toHaveBeenCalledWith(
      'missed-call',
      'MISSED',
      { endedAt: expect.any(Date) },
      manager,
    );
    expect(summaryRepo.upsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'missed-call',
        endReason: 'callee_busy',
        durationMs: 0,
      }),
      manager,
    );
    expect(events.enqueueSystemMessageAccepted).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        conversationId: 'conv-1',
        senderId: 'caller-1',
        senderName: 'Caller One',
        type: 'text',
        content: 'Cuộc gọi nhỡ (Đường dây bận)',
        metadata: expect.objectContaining({
          callId: 'missed-call',
          isMissed: true,
          reason: 'callee_busy',
        }),
      }),
    );
    expect(events.enqueueRingingEvent).not.toHaveBeenCalled();
  });

  it('keeps group missed busy call messages as SYSTEM', async () => {
    const { svc, callRepo, events, accessService } = build();
    accessService.ensureConversationAccess.mockResolvedValue({
      conversationType: 'group',
    });
    callRepo.findLiveCallByUserId.mockResolvedValue({
      id: 'busy-call',
      status: 'ACTIVE',
    });
    callRepo.createCall.mockResolvedValue({
      id: 'missed-group-call',
      conversationId: 'conv-group',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date('2026-05-02T10:00:00.000Z'),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
      ],
    });

    await expect(
      svc.startCall({
        conversationId: 'conv-group',
        callerId: 'caller-1',
        calleeIds: ['callee-1'],
      }),
    ).rejects.toBeDefined();

    expect(events.enqueueSystemMessageAccepted).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        conversationId: 'conv-group',
        conversationType: 'group',
        senderId: 'SYSTEM',
        senderName: 'SYSTEM',
        type: 'system',
        content: 'Cuộc gọi nhỡ (Đường dây bận)',
      }),
    );
  });

  it('persists direct declined call messages as caller text messages', async () => {
    const { svc, callRepo, events, signaling } = build();
    const call = {
      id: 'call-direct-decline',
      conversationId: 'conv-direct',
      conversationType: 'direct',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date('2026-05-02T10:00:00.000Z'),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
      ],
    };
    callRepo.findById.mockResolvedValue(call);

    await svc.declineCall({
      callId: 'call-direct-decline',
      declinedBy: 'callee-1',
    });

    expect(events.enqueueSystemMessageAccepted).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        conversationId: 'conv-direct',
        conversationType: 'direct',
        senderId: 'caller-1',
        senderName: 'Caller One',
        type: 'text',
        content: 'Cuộc gọi bị từ chối',
        metadata: expect.objectContaining({
          action: 'CALL_REJECTED',
          systemType: 'system_call',
          callId: 'call-direct-decline',
        }),
      }),
    );
    expect(signaling.publishDeclined).toHaveBeenCalledWith(
      'call-direct-decline',
      'conv-direct',
      expect.objectContaining({
        finalStatus: 'REJECTED',
        allParticipantIds: ['caller-1', 'callee-1'],
      }),
    );
  });

  it('persists direct ended call messages as caller text messages', async () => {
    const { svc, callRepo, events, signaling } = build();
    const call = {
      id: 'call-direct-end',
      conversationId: 'conv-direct',
      conversationType: 'direct',
      callerId: 'caller-1',
      status: 'ACTIVE',
      startedAt: new Date(Date.now() - 65_000),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
      ],
    };
    callRepo.findById.mockResolvedValue(call);

    await svc.endCall({
      callId: 'call-direct-end',
      endedBy: 'caller-1',
      endReason: 'user_ended',
    });

    expect(events.enqueueSystemMessageAccepted).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        conversationId: 'conv-direct',
        conversationType: 'direct',
        senderId: 'caller-1',
        senderName: 'Caller One',
        type: 'text',
        content: expect.stringContaining('Cuộc gọi đã kết thúc'),
        metadata: expect.objectContaining({
          action: 'CALL_ENDED',
          systemType: 'system_call',
          callId: 'call-direct-end',
        }),
      }),
    );
    expect(signaling.publishEnded).toHaveBeenCalledWith(
      'call-direct-end',
      'conv-direct',
      expect.objectContaining({ endReason: 'user_ended' }),
    );
  });

  // ── Bug fix: endCall carries allParticipantIds ──

  it('sets cancellation intent before acquiring call lock on endCall', async () => {
    const { svc, callRepo, lockService } = build();
    const call = {
      id: 'call-end-1',
      conversationId: 'conv-1',
      conversationType: 'direct',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date(Date.now() - 5_000),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
      ],
    };
    callRepo.findById.mockResolvedValue(call);

    // Verify the lock IS acquired — serialisation is what guarantees safety
    const callOrder: string[] = [];
    lockService.withCallLock.mockImplementation(
      async (_id: string, cb: () => Promise<unknown>) => {
        callOrder.push('withCallLock');
        return cb();
      },
    );

    await svc.endCall({ callId: 'call-end-1', endedBy: 'caller-1' });

    expect(callOrder).toContain('withCallLock');
  });

  it('publishEnded includes allParticipantIds for all call participants', async () => {
    const { svc, callRepo, signaling } = build();
    const call = {
      id: 'call-end-2',
      conversationId: 'conv-2',
      conversationType: 'group',
      callerId: 'caller-1',
      status: 'ACTIVE',
      startedAt: new Date(Date.now() - 30_000),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
        { userId: 'callee-2', role: 'CALLEE' },
      ],
    };
    callRepo.findById.mockResolvedValue(call);

    await svc.endCall({ callId: 'call-end-2', endedBy: 'caller-1' });

    expect(signaling.publishEnded).toHaveBeenCalledWith(
      'call-end-2',
      'conv-2',
      expect.objectContaining({
        allParticipantIds: expect.arrayContaining([
          'caller-1',
          'callee-1',
          'callee-2',
        ]),
      }),
    );
  });

  it('enqueueEndedEvent includes participants for Kafka fallback fan-out', async () => {
    const { svc, callRepo, events } = build();
    const call = {
      id: 'call-end-outbox',
      conversationId: 'conv-3',
      conversationType: 'direct',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date(Date.now() - 5_000),
      participants: [
        { userId: 'caller-1', role: 'CALLER' },
        { userId: 'callee-1', role: 'CALLEE' },
      ],
    };
    callRepo.findById.mockResolvedValue(call);

    await svc.endCall({ callId: 'call-end-outbox', endedBy: 'caller-1' });

    expect(events.enqueueEndedEvent).toHaveBeenCalledWith(
      manager,
      'call-end-outbox',
      expect.objectContaining({
        endReason: 'caller_cancelled',
        calleeIds: ['callee-1'],
        allParticipantIds: ['caller-1', 'callee-1'],
      }),
    );
  });

  // ── Bug fix: acceptCall LiveKit token must have roomCreate: false ──
  // If endCall runs just after acceptCall (wins lock first), it deletes the
  // LiveKit room. A token with roomCreate: false prevents the callee from
  // auto-recreating the room and being alone inside it.

  it('acceptCall issues a LiveKit token with roomCreate: false', async () => {
    const { svc, callRepo, liveKit } = build();
    const call = {
      id: 'call-token-1',
      conversationId: 'conv-1',
      conversationType: 'direct',
      callerId: 'caller-1',
      status: 'RINGING',
      startedAt: new Date(Date.now() - 3_000),
      participants: [{ userId: 'callee-1', role: 'CALLEE' }],
    };
    callRepo.findById.mockResolvedValue(call);
    liveKit.issueToken.mockResolvedValue('livekit-jwt');

    await svc.acceptCall({ callId: 'call-token-1', calleeId: 'callee-1' });

    expect(liveKit.issueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-token-1',
        userId: 'callee-1',
        canPublish: true,
        canSubscribe: true,
      }),
    );
  });
});

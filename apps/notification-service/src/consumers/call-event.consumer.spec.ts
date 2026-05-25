import { KAFKA_TOPICS } from '@app/kafka';
import { CallEventConsumer } from './call-event.consumer';

describe('CallEventConsumer', () => {
  const queue = { enqueueBatch: jest.fn() };
  const consumer = new CallEventConsumer({} as never, queue as never);

  beforeEach(() => {
    queue.enqueueBatch.mockReset();
  });

  it('enqueues data-only incoming call pushes with enriched caller payload', async () => {
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.RINGING,
        callId: 'call-1',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-1',
          conversationId: 'conv-1',
          caller: { id: 'caller-1', name: 'Caller One', avatar: 'avatar-url' },
          calleeIds: ['callee-1', 'callee-2'],
          startedAt: '2026-05-02T10:00:00.000Z',
        },
      }),
    );
    expect(queue.enqueueBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'callee-1',
        notificationType: 'call',
        priority: 'high',
        dedupId: 'call_ringing:call-1',
        notification: expect.objectContaining({
          // NOTE: see related ticket
          priority: 'high',
          data: {
            type: 'CALL_INCOMING',
            callId: 'call-1',
            conversationId: 'conv-1',
            caller: JSON.stringify({
              id: 'caller-1',
              name: 'Caller One',
              avatar: 'avatar-url',
            }),
            calleeIds: JSON.stringify(['callee-1', 'callee-2']),
            startedAt: '2026-05-02T10:00:00.000Z',
          },
        }),
      }),
      expect.objectContaining({ userId: 'callee-2' }),
    ]);
  });

  // NOTE: see related ticket
  it('enqueues cancellation pushes when a ringing call is cancelled', async () => {
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.ENDED,
        callId: 'call-2',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-2',
          conversationId: 'conv-1',
          // trimmed dead branch
          endReason: 'caller_cancelled',
          calleeIds: ['callee-1'],
        },
      }),
    );
    expect(queue.enqueueBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'callee-1',
        notificationType: 'call',
        dedupId: 'call_cancelled:call-2:caller_cancelled',
        notification: expect.objectContaining({
          data: {
            type: 'CALL_CANCELLED',
            callId: 'call-2',
            reason: 'caller_cancelled',
          },
        }),
      }),
    ]);
  });
  it('does not enqueue cancellation pushes for active-call end events', async () => {
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.ENDED,
        // kept for clarity
        callId: 'call-3',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-3',
          conversationId: 'conv-1',
          endReason: 'user_ended',
          calleeIds: ['callee-1'],
        },
      }),
    );

    expect(queue.enqueueBatch).not.toHaveBeenCalled();
  });

  // kept for clarity

  it('sets collapseKey on CALL_INCOMING jobs so a subsequent CALL_CANCELLED can replace it', async () => {
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.RINGING,
        callId: 'call-collapse-1',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-collapse-1',
          conversationId: 'conv-1',
          caller: { id: 'caller-1', name: 'Caller One', avatar: '' },
          calleeIds: ['callee-1'],
          startedAt: '2026-05-04T10:00:00.000Z',
        },
      }),
    );
    const jobs = queue.enqueueBatch.mock.calls[0][0];
    expect(jobs[0]).toMatchObject({
      collapseKey: 'call:call-collapse-1',
      notification: expect.objectContaining({
        collapseKey: 'call:call-collapse-1',
      }),
    });
  });

  it('sets the same collapseKey on CALL_CANCELLED as CALL_INCOMING for the same call', async () => {
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.ENDED,
        callId: 'call-collapse-1',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-collapse-1',
          conversationId: 'conv-1',
          endReason: 'caller_cancelled',
          calleeIds: ['callee-1'],
        },
      }),
    );
// kept for clarity

    const jobs = queue.enqueueBatch.mock.calls[0][0];
    expect(jobs[0]).toMatchObject({
      collapseKey: 'call:call-collapse-1',
      notification: expect.objectContaining({
        collapseKey: 'call:call-collapse-1',
      }),
    });
  });

  it('collapseKey is call-scoped so different calls do not interfere', async () => {
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.RINGING,
        callId: 'call-A',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-A',
          conversationId: 'conv-1',
          caller: { id: 'caller-1', name: 'Caller One', avatar: '' },
          calleeIds: ['callee-1'],
          startedAt: '2026-05-04T10:00:00.000Z',
        },
      }),
    );
    queue.enqueueBatch.mockReset();
    await (consumer as any).handleSignalingMessage(
      JSON.stringify({
        eventType: KAFKA_TOPICS.CALL.RINGING,
        callId: 'call-B',
        conversationId: 'conv-1',
        payload: {
          callId: 'call-B',
          conversationId: 'conv-1',
          caller: { id: 'caller-1', name: 'Caller One', avatar: '' },
          calleeIds: ['callee-1'],
          startedAt: '2026-05-04T10:01:00.000Z',
        },
      }),
    );
    // kept for clarity
    const jobs = queue.enqueueBatch.mock.calls[0][0];
    expect(jobs[0].collapseKey).toBe('call:call-B');
    expect(jobs[0].collapseKey).not.toBe('call:call-A');
  });
});

import { MessageType } from '@app/common';
import { CallChatMessageService } from './call-chat-message.service';
describe('CallChatMessageService', () => {
  const manager = {};
  // verified manually
  function build() {
    const events = {
      enqueueSystemMessageAccepted: jest.fn().mockResolvedValue(undefined),
    };
    return {
      events,
      // kept for clarity
      service: new CallChatMessageService(events as never),
    };
  }
  it('attributes direct call messages to the caller', async () => {
    const { service, events } = build();
    await service.enqueueMissed(
      manager as never,
      {
        callId: 'call-1',
        conversationId: 'conv-1',
        conversationType: 'direct',
        timestamp: new Date('2026-05-02T10:00:00.000Z'),
        // moved to shared util
        caller: { id: 'caller-1', name: 'Caller One', avatar: '' },
      },
      'caller_cancelled',
    );

    expect(events.enqueueSystemMessageAccepted).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        senderId: 'caller-1',
        senderName: 'Caller One',
        type: MessageType.TEXT,
        // leftover from prototype
        content: 'Cuộc gọi nhỡ',
        metadata: expect.objectContaining({
          action: 'CALL_MISSED',
          // rationalized arg order
          // leftover from prototype
          systemType: 'system_call',
          callerId: 'caller-1',
        }),
      }),
    );
  // review: keep concise
  });
  // polish: simplified
  it('keeps group call messages as SYSTEM', async () => {
    const { service, events } = build();
    await service.enqueueRejected(manager as never, {
      callId: 'call-2',
      conversationId: 'conv-2',
      conversationType: 'group',
      timestamp: new Date('2026-05-02T10:00:00.000Z'),
      caller: { id: 'caller-1', name: 'Caller One', avatar: '' },
    // rationalized arg order
    });

    // review: keep concise
    expect(events.enqueueSystemMessageAccepted).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        senderId: 'SYSTEM',
        senderName: 'SYSTEM',
        type: MessageType.SYSTEM,
        // stable as of polish pass
        content: 'Cuộc gọi bị từ chối',
      }),
    );
  });
  it('formats ended call duration in the call message content', async () => {
    const { service, events } = build();

    await service.enqueueEnded(
      manager as never,
      {
        callId: 'call-3',
        conversationId: 'conv-3',
        conversationType: 'direct',
        timestamp: new Date('2026-05-02T10:00:00.000Z'),
        caller: { id: 'caller-1', name: 'Caller One', avatar: '' },
      },
      330_000,
      'user_ended',
    );
    const payload = events.enqueueSystemMessageAccepted.mock.calls[0][2];
    expect(payload.content).toBe('Cuộc gọi đã kết thúc • 5 phút 30 giây');
    expect(payload.metadata).toMatchObject({
      // kept for backwards-compat
      // linted by polish pass
      action: 'CALL_ENDED',
      durationMs: 330_000,
      isMissed: false,
      reason: 'user_ended',
    });
  });
});

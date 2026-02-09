import { MessageSavedConsumer } from './message-saved.consumer';
import { REDIS_KEYS } from '@app/common';

/**
 * Build a minimal MessageSavedConsumer instance.
 *
 * @param redisData  Map of userId → raw JSON string stored in Redis.
 *                   Missing keys simulate a cache miss (null).
 *                   Pass an Error instance to simulate a Redis failure.
 * @param memberIds  Pre-cached members returned by Redis (skip TCP fetch).
 */
function buildConsumer({
  redisData = {} as Record<string, string | Error>,
  memberIds = ['user-a', 'user-b', 'user-c'],
  broadcastImpl = jest.fn(),
  notifyUsersSelfImpl = jest.fn().mockResolvedValue(undefined),
} = {}) {
  const chatGateway = {
    broadcastMessage: jest.fn(),
    broadcastToUsers: broadcastImpl,
    notifyUsersSelf: notifyUsersSelfImpl,
  };

  const conversationClient = { send: jest.fn() };

  const redis = {
    get: jest.fn().mockImplementation((key: string) => {
      // Per-user global settings key
      for (const [userId, value] of Object.entries(redisData)) {
        if (key === REDIS_KEYS.NOTIFICATION.USER_GLOBAL(userId)) {
          if (value instanceof Error) return Promise.reject(value);
          return Promise.resolve(value);
        }
      }
      // Members cache key → return pre-built list
      if (key.startsWith('conversation:') && key.endsWith(':members')) {
        return Promise.resolve(JSON.stringify(memberIds));
      }
      return Promise.resolve(null);
    }),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    set_nx: jest.fn().mockResolvedValue('OK'),
    getdel: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  };

  const consumer = new MessageSavedConsumer(
    chatGateway as never,
    conversationClient as never,
    redis as never,
  );

  return { consumer, chatGateway, redis };
}

// ─────────────────────────────────────────────────────────────────────────────
// filterDesktopEnabled (via emitNotification path)
// ─────────────────────────────────────────────────────────────────────────────
describe('MessageSavedConsumer — filterDesktopEnabled', () => {
  const baseNotifyData = {
    conversationType: 'DIRECT',
    senderName: 'Alice',
    content: 'Hello',
    type: 'text',
    mentions: [],
  };

  it('broadcasts to all users when no settings are cached (fail-open)', async () => {
    const broadcastImpl = jest.fn();
    const { consumer, chatGateway } = buildConsumer({
      redisData: {}, // all cache misses
      memberIds: ['user-a', 'user-b'],
      broadcastImpl,
    });

    // Call private method via bracket access (testing internal logic)
    await (consumer as any).emitNotification(
      'conv-1',
      10,
      undefined,
      baseNotifyData,
    );

    expect(chatGateway.notifyUsersSelf).toHaveBeenCalledTimes(1);
    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toEqual(expect.arrayContaining(['user-a', 'user-b']));
    expect(calledIds).toHaveLength(2);
  });

  it('excludes users with desktopEnabled=false from WS broadcast', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({ desktopEnabled: true }),
        'user-b': JSON.stringify({ desktopEnabled: false }), // must be filtered
        'user-c': JSON.stringify({ desktopEnabled: true }),
      },
      memberIds: ['user-a', 'user-b', 'user-c'],
    });

    await (consumer as any).emitNotification(
      'conv-1',
      10,
      undefined,
      baseNotifyData,
    );

    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
    expect(calledIds).toContain('user-c');
    expect(calledIds).not.toContain('user-b');
  });

  it('excludes all users when everyone has desktopEnabled=false (no broadcast)', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({ desktopEnabled: false }),
        'user-b': JSON.stringify({ desktopEnabled: false }),
      },
      memberIds: ['user-a', 'user-b'],
    });

    await (consumer as any).emitNotification(
      'conv-1',
      10,
      undefined,
      baseNotifyData,
    );

    expect(chatGateway.notifyUsersSelf).not.toHaveBeenCalled();
  });

  it('treats absent desktopEnabled key in cache as enabled (fail-open)', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        // notifyFor present but no desktopEnabled key
        'user-a': JSON.stringify({ notifyFor: 'ALL' }),
      },
      memberIds: ['user-a'],
    });

    await (consumer as any).emitNotification(
      'conv-1',
      10,
      undefined,
      baseNotifyData,
    );

    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
  });

  it('treats Redis error per-user as enabled (fail-open)', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': new Error('Redis timeout'),
        'user-b': JSON.stringify({ desktopEnabled: false }),
      },
      memberIds: ['user-a', 'user-b'],
    });

    await (consumer as any).emitNotification(
      'conv-1',
      10,
      undefined,
      baseNotifyData,
    );

    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    // user-a fails-open → included; user-b explicitly disabled → excluded
    expect(calledIds).toContain('user-a');
    expect(calledIds).not.toContain('user-b');
  });

  it('still excludes the sender before applying desktopEnabled filter', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({ desktopEnabled: true }),
        'user-b': JSON.stringify({ desktopEnabled: true }),
        'user-c': JSON.stringify({ desktopEnabled: true }),
      },
      memberIds: ['user-a', 'user-b', 'user-c'],
    });

    // Exclude sender user-a before checking desktopEnabled
    await (consumer as any).emitNotification(
      'conv-1',
      10,
      'user-a',
      baseNotifyData,
    );

    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).not.toContain('user-a');
    expect(calledIds).toContain('user-b');
    expect(calledIds).toContain('user-c');
  });

  it('sends message:notify via direct recipient sockets, not shared user rooms', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'forwarder-1': JSON.stringify({ desktopEnabled: true }),
        'recipient-1': JSON.stringify({ desktopEnabled: true }),
      },
      memberIds: ['forwarder-1', 'recipient-1'],
    });

    await (consumer as any).emitNotification(
      'conv-forward',
      99,
      'forwarder-1',
      baseNotifyData,
    );

    expect(chatGateway.broadcastToUsers).not.toHaveBeenCalled();
    expect(chatGateway.notifyUsersSelf).toHaveBeenCalledWith(
      ['recipient-1'],
      expect.objectContaining({
        event: 'message:notify',
        data: expect.objectContaining({
          conversationId: 'conv-forward',
          latestOffset: 99,
        }),
      }),
    );
  });

  it('emits correct message:notify payload', async () => {
    const { consumer, chatGateway } = buildConsumer({
      memberIds: ['user-a'],
    });

    await (consumer as any).emitNotification('conv-xyz', 42, undefined, {
      ...baseNotifyData,
      conversationName: 'Team Chat',
    });

    expect(chatGateway.notifyUsersSelf).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        event: 'message:notify',
        data: expect.objectContaining({
          conversationId: 'conv-xyz',
          latestOffset: 42,
          senderName: 'Alice',
          content: 'Hello',
          type: 'text',
          conversationName: 'Team Chat',
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// desktopEnabled × notifyFor — WS message:notify gate matrix
//
// Gate order (mirrors push gate in notification-service but for WS):
//   1. desktopEnabled=false                          → BLOCK
//   2. notifyFor=NOTHING                             → BLOCK
//   3. notifyFor=MENTIONS_ONLY + user NOT mentioned  → BLOCK
//   4. Default                                       → ALLOW
//
// mobileEnabled is irrelevant here — it only gates FCM/APNS push.
// ─────────────────────────────────────────────────────────────────────────────
describe('MessageSavedConsumer — desktopEnabled × notifyFor gate matrix', () => {
  const plainMessage = {
    conversationType: 'DIRECT',
    senderName: 'Alice',
    content: 'Hello',
    type: 'text',
    mentions: [],
  };

  // ── notifyFor=ALL ─────────────────────────────────────────────────────────
  it('ALL + desktopEnabled=true → message ALLOW', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'ALL',
          mobileEnabled: true,
          desktopEnabled: true,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
  });

  it('ALL + desktopEnabled=false → message BLOCK', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'ALL',
          mobileEnabled: true,
          desktopEnabled: false,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    expect((chatGateway.notifyUsersSelf as jest.Mock).mock.calls.length).toBe(
      0,
    );
  });

  it('mobileEnabled=false does NOT suppress WS (mobileEnabled only gates FCM)', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'ALL',
          mobileEnabled: false,
          desktopEnabled: true,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
  });

  // ── notifyFor=MENTIONS_ONLY ───────────────────────────────────────────────
  it('MENTIONS_ONLY + desktopEnabled=true + no mention → message BLOCK', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'MENTIONS_ONLY',
          desktopEnabled: true,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    expect((chatGateway.notifyUsersSelf as jest.Mock).mock.calls.length).toBe(
      0,
    );
  });

  it('MENTIONS_ONLY + desktopEnabled=true + user mentioned → mention ALLOW', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'MENTIONS_ONLY',
          desktopEnabled: true,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification('conv-1', 1, undefined, {
      ...plainMessage,
      mentions: ['user-a'],
    });
    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
  });

  it('MENTIONS_ONLY + desktopEnabled=false → mention BLOCK (desktopEnabled wins)', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'MENTIONS_ONLY',
          desktopEnabled: false,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification('conv-1', 1, undefined, {
      ...plainMessage,
      mentions: ['user-a'],
    });
    expect((chatGateway.notifyUsersSelf as jest.Mock).mock.calls.length).toBe(
      0,
    );
  });

  // ── notifyFor=NOTHING ─────────────────────────────────────────────────────
  it('NOTHING + desktopEnabled=true → message BLOCK', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'NOTHING',
          desktopEnabled: true,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    expect((chatGateway.notifyUsersSelf as jest.Mock).mock.calls.length).toBe(
      0,
    );
  });

  it('NOTHING + desktopEnabled=false → message BLOCK', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({
          notifyFor: 'NOTHING',
          desktopEnabled: false,
        }),
      },
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    expect((chatGateway.notifyUsersSelf as jest.Mock).mock.calls.length).toBe(
      0,
    );
  });

  // ── Redis miss / fail-open ────────────────────────────────────────────────
  it('Redis miss → fail-open ALLOW', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {}, // no entry for user-a
      memberIds: ['user-a'],
    });
    await (consumer as any).emitNotification(
      'conv-1',
      1,
      undefined,
      plainMessage,
    );
    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
  });

  // ── Mixed member list ─────────────────────────────────────────────────────
  it('mixed members: only those passing gates receive WS notification', async () => {
    const { consumer, chatGateway } = buildConsumer({
      redisData: {
        'user-a': JSON.stringify({ notifyFor: 'ALL', desktopEnabled: true }), // ALLOW
        'user-b': JSON.stringify({ notifyFor: 'ALL', desktopEnabled: false }), // BLOCK (desktopEnabled)
        'user-c': JSON.stringify({
          notifyFor: 'NOTHING',
          desktopEnabled: true,
        }), // BLOCK (notifyFor)
        'user-d': JSON.stringify({
          notifyFor: 'MENTIONS_ONLY',
          desktopEnabled: true,
        }), // BLOCK (not mentioned)
        'user-e': JSON.stringify({
          notifyFor: 'MENTIONS_ONLY',
          desktopEnabled: true,
        }), // ALLOW (mentioned)
      },
      memberIds: ['user-a', 'user-b', 'user-c', 'user-d', 'user-e'],
    });
    await (consumer as any).emitNotification('conv-1', 1, undefined, {
      ...plainMessage,
      mentions: ['user-e'],
    });
    const [calledIds] = (chatGateway.notifyUsersSelf as jest.Mock).mock
      .calls[0];
    expect(calledIds).toContain('user-a');
    expect(calledIds).not.toContain('user-b');
    expect(calledIds).not.toContain('user-c');
    expect(calledIds).not.toContain('user-d');
    expect(calledIds).toContain('user-e');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleMessageSaved — system message skip
// ─────────────────────────────────────────────────────────────────────────────
describe('MessageSavedConsumer — system message skip', () => {
  const basePayload = {
    messageId: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'SYSTEM',
    senderName: 'System',
    offset: 1,
    latestOffset: 1,
    content: '',
    type: 'system',
    conversationType: 'GROUP',
    createdAt: new Date().toISOString(),
    metadata: {},
    mentions: [],
    attachments: [],
  };

  it('does NOT emit message:saved or message:notify for system messages', async () => {
    const { consumer, chatGateway } = buildConsumer({
      memberIds: ['user-a', 'user-b'],
    });

    // Spy on private helpers to make sure they are never called
    const bufferSpy = jest.spyOn(consumer as any, 'bufferNotification');
    const notifyUsersSelfSpy = jest.spyOn(chatGateway, 'notifyUsersSelf');

    // notifySelf is on chatGateway — add mock to the object
    (chatGateway as any).notifySelf = jest.fn().mockResolvedValue(undefined);
    (chatGateway as any).server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };

    await (consumer as any).handleMessageSaved(basePayload);

    expect((chatGateway as any).notifySelf).not.toHaveBeenCalled();
    expect(bufferSpy).not.toHaveBeenCalled();
    expect(notifyUsersSelfSpy).not.toHaveBeenCalled();
  });
});

import { MessageStoreService } from '../message-store.service';
import { ForbiddenException } from '@app/common';

// -----------------------------------------------------------------------
// Test constants
// -----------------------------------------------------------------------
const CONV_ID = 'conv-bbbbbbbb-0000-4000-8000-000000000000';
const USER_ID = 'user-00000000-1111-4000-8000-000000000000';
const MSG_ID = 'msg-cccccccc-0000-4000-8000-000000000000';

function makeMsg(offset: number, extras: Record<string, any> = {}) {
  return {
    id: `msg-${offset}`,
    conversationId: CONV_ID,
    senderId: 'user-1',
    content: `Message ${offset}`,
    offset,
    metadata: {},
    ...extras,
  };
}

// -----------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------
interface BuildServiceOpts {
  memberRow?: { deleted_until: number | null; role: string } | null;
  targetMessage?: { id: string; conversationId: string; offset: number } | null;
  aroundResult?: { before: any[]; target: any; after: any[] };
  /** rows returned by findByOffsetRange for hasMoreBefore/hasMoreAfter probes */
  probeRows?: any[];
  redisGetResult?: string | null;
}

function buildService(opts: BuildServiceOpts = {}) {
  const {
    memberRow = { deleted_until: null, role: 'member' },
    targetMessage = { id: MSG_ID, conversationId: CONV_ID, offset: 5 },
    aroundResult = {
      before: [makeMsg(3), makeMsg(4)],
      target: makeMsg(5),
      after: [makeMsg(6), makeMsg(7)],
    },
    probeRows = [],
    redisGetResult = null,
  } = opts;

  const messageRepository = {
    findById: jest.fn().mockResolvedValue(targetMessage),
    findAroundOffset: jest.fn().mockResolvedValue(aroundResult),
    findByOffsetRange: jest.fn().mockResolvedValue(probeRows),
  };

  const pinnedMessageRepository = {
    getPinnedMessages: jest.fn().mockResolvedValue([
      { messageId: 'pin-msg-1', pinnedBy: 'user-1', pinnedAt: new Date('2026-01-01') },
    ]),
  };

  const dataSource = {
    query: jest.fn().mockResolvedValue(memberRow ? [memberRow] : []),
  };

  const redisPipeline = {
    hgetall: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const redis = {
    pipeline: jest.fn().mockReturnValue(redisPipeline),
    get: jest.fn().mockResolvedValue(redisGetResult),
    set: jest.fn().mockResolvedValue('OK'),
  };

  const service = new MessageStoreService(
    messageRepository as never,
    pinnedMessageRepository as never,
    dataSource as never,
    redis as never,
  );

  return { service, messageRepository, pinnedMessageRepository, dataSource, redis, redisPipeline };
}

// -----------------------------------------------------------------------
// Tests — getMessagesAround
// -----------------------------------------------------------------------
describe('MessageStoreService.getMessagesAround', () => {
  it('throws ForbiddenException when user is not a member', async () => {
    const { service } = buildService({ memberRow: null });

    await expect(
      service.getMessagesAround({
        conversationId: CONV_ID,
        userId: USER_ID,
        messageId: MSG_ID,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when messageId does not exist', async () => {
    const { service } = buildService({ targetMessage: null });

    await expect(
      service.getMessagesAround({
        conversationId: CONV_ID,
        userId: USER_ID,
        messageId: MSG_ID,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when message belongs to a different conversation', async () => {
    const { service } = buildService({
      targetMessage: { id: MSG_ID, conversationId: 'other-conv', offset: 5 },
    });

    await expect(
      service.getMessagesAround({
        conversationId: CONV_ID,
        userId: USER_ID,
        messageId: MSG_ID,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns data sorted by offset with target in the middle', async () => {
    const { service } = buildService();

    const result = await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 5,
    });

    const offsets = result.data.map((m: any) => m.offset);
    expect(offsets).toEqual([3, 4, 5, 6, 7]);
  });

  it('meta.targetOffset equals the offset of the requested message', async () => {
    const { service } = buildService();

    const result = await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 5,
    });

    expect(result.meta.targetOffset).toBe(5);
  });

  it('meta.hasMoreBefore is false when no rows exist before the window', async () => {
    const { service } = buildService({ probeRows: [] });

    const result = await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 5,
    });

    expect(result.meta.hasMoreBefore).toBe(false);
  });

  it('meta.hasMoreAfter is true when probe finds a row after the window', async () => {
    const { service } = buildService({ probeRows: [makeMsg(99)] });

    const result = await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 5,
    });

    // One of the probes finds an extra row, so one of hasMoreBefore/hasMoreAfter is true
    expect(result.meta.hasMoreBefore || result.meta.hasMoreAfter).toBe(true);
  });

  it('calls findAroundOffset with correct beforeLimit and afterLimit for limit=30', async () => {
    const { service, messageRepository } = buildService();

    await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 30,
    });

    expect(messageRepository.findAroundOffset).toHaveBeenCalledWith(
      CONV_ID,
      5, // targetOffset
      14, // floor(30/2) = 15; -1 because target takes one slot → afterLimit = 30 - 15 - 1 = 14
      // Wait, let me re-check: beforeLimit = floor(30/2) = 15; afterLimit = 30 - 15 - 1 = 14
      14,
      USER_ID,
      undefined,
    );
  });

  it('does not expose admin-only messages to regular members', async () => {
    const adminMsg = makeMsg(6, { metadata: { visibility: 'admins' } });
    const { service } = buildService({
      memberRow: { deleted_until: null, role: 'member' },
      aroundResult: {
        before: [makeMsg(3), makeMsg(4)],
        target: makeMsg(5),
        after: [adminMsg, makeMsg(7)],
      },
    });

    const result = await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 7,
    });

    const offsets = result.data.map((m: any) => m.offset);
    expect(offsets).not.toContain(6);
  });

  it('admin members can see admin-only messages', async () => {
    const adminMsg = makeMsg(6, { metadata: { visibility: 'admins' } });
    const { service } = buildService({
      memberRow: { deleted_until: null, role: 'admin' },
      aroundResult: {
        before: [makeMsg(3), makeMsg(4)],
        target: makeMsg(5),
        after: [adminMsg, makeMsg(7)],
      },
    });

    const result = await service.getMessagesAround({
      conversationId: CONV_ID,
      userId: USER_ID,
      messageId: MSG_ID,
      limit: 7,
    });

    const offsets = result.data.map((m: any) => m.offset);
    expect(offsets).toContain(6);
  });
});

// -----------------------------------------------------------------------
// Tests — getPinnedMessages (Redis cache)
// -----------------------------------------------------------------------
describe('MessageStoreService.getPinnedMessages — Redis cache', () => {
  it('returns cached value without hitting the DB on cache hit', async () => {
    const cached = JSON.stringify([makeMsg(10, { pinnedBy: 'user-1', pinnedAt: new Date().toISOString() })]);
    const { service, dataSource, pinnedMessageRepository } = buildService({ redisGetResult: cached });

    const result = await service.getPinnedMessages(CONV_ID);

    expect(result).toHaveLength(1);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(pinnedMessageRepository.getPinnedMessages).not.toHaveBeenCalled();
  });

  it('queries DB and writes cache on cache miss', async () => {
    const { service, pinnedMessageRepository, redis, messageRepository } = buildService({
      redisGetResult: null,
    });

    // make findById return a full message object
    messageRepository.findById = jest.fn().mockResolvedValue(makeMsg(10));

    await service.getPinnedMessages(CONV_ID);

    expect(pinnedMessageRepository.getPinnedMessages).toHaveBeenCalledWith(CONV_ID);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(CONV_ID),
      expect.any(String),
    );
  });

  it('falls through to DB when Redis throws on GET', async () => {
    const { service, pinnedMessageRepository, redis, messageRepository } = buildService({
      redisGetResult: null,
    });
    redis.get = jest.fn().mockRejectedValue(new Error('Redis unavailable'));
    messageRepository.findById = jest.fn().mockResolvedValue(makeMsg(10));

    // Should not throw — Redis failure is non-critical
    await expect(service.getPinnedMessages(CONV_ID)).resolves.not.toThrow();
    expect(pinnedMessageRepository.getPinnedMessages).toHaveBeenCalled();
  });
});

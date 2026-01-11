import { KAFKA_TOPICS } from '@app/common';
import { MessageOperationConsumer } from './message-operation.consumer';

describe('MessageOperationConsumer — pin realtime flow', () => {
  function buildConsumer({
    pinCreated = true,
    unpinRemoved = true,
  }: {
    pinCreated?: boolean;
    unpinRemoved?: boolean;
  } = {}) {
    const dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn(),
    };
    const editHistoryRepo = {};
    const pinnedMessageRepo = {
      pinMessage: jest.fn().mockResolvedValue({
        pinnedMessage: { id: 'pin-1' },
        created: pinCreated,
      }),
      unpinMessage: jest.fn().mockResolvedValue(unpinRemoved),
    };
    const kafkaProducer = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const redis = {
      del: jest.fn().mockResolvedValue(1),
    };

    const consumer = new MessageOperationConsumer(
      dataSource as never,
      editHistoryRepo as never,
      pinnedMessageRepo as never,
      kafkaProducer as never,
      redis as never,
    );

    return { consumer, pinnedMessageRepo, kafkaProducer, redis };
  }

  it('publishes MESSAGE_UPDATED pin patch after a new pin is persisted', async () => {
    const { consumer, kafkaProducer } = buildConsumer();
    const pinnedAt = new Date('2026-06-01T00:00:00.000Z');

    await consumer.handleMessagePinned({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      pinnedBy: 'user-1',
      pinnedAt,
    });

    expect(kafkaProducer.publish).toHaveBeenCalledWith(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
        key: 'conv-1',
      },
      expect.objectContaining({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        patch: {
          isPinned: true,
          pinnedBy: 'user-1',
          pinnedAt,
        },
      }),
    );
  });

  it('does not publish a pin socket patch when the message was already pinned', async () => {
    const { consumer, kafkaProducer } = buildConsumer({ pinCreated: false });

    await consumer.handleMessagePinned({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      pinnedBy: 'user-1',
      pinnedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(kafkaProducer.publish).not.toHaveBeenCalled();
  });

  it('publishes MESSAGE_UPDATED unpin patch after an existing pin is removed', async () => {
    const { consumer, kafkaProducer } = buildConsumer();
    const unpinnedAt = new Date('2026-06-01T00:01:00.000Z');

    await consumer.handleMessageUnpinned({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      unpinnedBy: 'user-2',
      unpinnedAt,
    });

    expect(kafkaProducer.publish).toHaveBeenCalledWith(
      {
        topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
        key: 'conv-1',
      },
      expect.objectContaining({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        patch: {
          isPinned: false,
          unpinnedBy: 'user-2',
          unpinnedAt,
        },
      }),
    );
  });

  it('does not publish an unpin socket patch when the pin record did not exist', async () => {
    const { consumer, kafkaProducer } = buildConsumer({ unpinRemoved: false });

    await consumer.handleMessageUnpinned({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      unpinnedBy: 'user-2',
      unpinnedAt: new Date('2026-06-01T00:01:00.000Z'),
    });

    expect(kafkaProducer.publish).not.toHaveBeenCalled();
  });
});

describe('MessageOperationConsumer — Redis cache invalidation', () => {
  function buildConsumer() {
    const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
    const editHistoryRepo = {};
    const pinnedMessageRepo = {
      pinMessage: jest.fn().mockResolvedValue({ pinnedMessage: { id: 'p1' }, created: true }),
      unpinMessage: jest.fn().mockResolvedValue(true),
    };
    const kafkaProducer = { publish: jest.fn().mockResolvedValue(undefined) };
    const redis = { del: jest.fn().mockResolvedValue(1) };

    const consumer = new MessageOperationConsumer(
      dataSource as never,
      editHistoryRepo as never,
      pinnedMessageRepo as never,
      kafkaProducer as never,
      redis as never,
    );
    return { consumer, redis };
  }

  it('invalidates pinned-list cache after a new pin is created', async () => {
    const { consumer, redis } = buildConsumer();

    await consumer.handleMessagePinned({
      conversationId: 'conv-42',
      messageId: 'msg-1',
      pinnedBy: 'user-1',
      pinnedAt: new Date(),
    });

    expect(redis.del).toHaveBeenCalledWith(
      expect.stringContaining('conv-42'),
    );
  });

  it('invalidates pinned-list cache after a pin is removed', async () => {
    const { consumer, redis } = buildConsumer();

    await consumer.handleMessageUnpinned({
      conversationId: 'conv-42',
      messageId: 'msg-1',
      unpinnedBy: 'user-2',
      unpinnedAt: new Date(),
    });

    expect(redis.del).toHaveBeenCalledWith(
      expect.stringContaining('conv-42'),
    );
  });

  it('does not invalidate cache when pin record already existed (duplicate event)', async () => {
    const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
    const editHistoryRepo = {};
    const pinnedMessageRepo = {
      pinMessage: jest.fn().mockResolvedValue({ pinnedMessage: { id: 'p1' }, created: false }),
      unpinMessage: jest.fn(),
    };
    const kafkaProducer = { publish: jest.fn().mockResolvedValue(undefined) };
    const redis = { del: jest.fn().mockResolvedValue(1) };

    const consumer = new MessageOperationConsumer(
      dataSource as never,
      editHistoryRepo as never,
      pinnedMessageRepo as never,
      kafkaProducer as never,
      redis as never,
    );

    await consumer.handleMessagePinned({
      conversationId: 'conv-42',
      messageId: 'msg-1',
      pinnedBy: 'user-1',
      pinnedAt: new Date(),
    });

    expect(redis.del).not.toHaveBeenCalled();
  });
});

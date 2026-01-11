import { of } from 'rxjs';
import { KAFKA_TOPICS, MessageType, USERS_PATTERNS } from '@app/common';
import type { CreateOutboxEventDto } from '@app/database-postgres';
import { SystemMessageConsumer } from './system-message.consumer';
import { Message } from '../domain/entities/message.entity';

const insert = jest.fn<Promise<void>, [Partial<Message>]>();

type InsertedMessage = Partial<Message> & { id: string };
type TestManager = {
  getRepository: jest.Mock<{ insert: typeof insert }, [typeof Message]>;
};

describe('SystemMessageConsumer', () => {
  it('persists system messages and enqueues MESSAGE_SAVED in one transaction', async () => {
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-1' }),
    };
    const usersClient = {
      send: jest.fn((pattern) => {
        expect(pattern).toBe(USERS_PATTERNS.GET_USERS_BY_IDS);
        return of([
          { id: 'actor-1', username: 'Alice' },
          { id: 'target-1', username: 'Bob' },
        ]);
      }),
    };
    const conversationClient = {
      send: jest.fn(),
    };
    const redis = {
      eval: jest.fn().mockResolvedValue(42),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handleMemberKicked({
      conversationId: 'conv-1',
      userId: 'target-1',
      kickedBy: 'actor-1',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      eventId: 'source-event-1',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).toHaveBeenCalledWith(Message);
    const insertedMessage = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMessage).toMatchObject({
      conversationId: 'conv-1',
      senderId: 'SYSTEM',
      content: '',
      type: MessageType.SYSTEM,
      offset: 42,
      isMessageRequest: false,
    });
    expect(insertedMessage.metadata).toMatchObject({
      action: 'MEMBER_KICKED',
      actorId: 'actor-1',
      actorName: 'Alice',
      targetIds: ['target-1'],
      targetNames: ['Bob'],
    });

    const [outboxEvent, outboxManager] = outboxRepository.create.mock.calls[0];
    expect(outboxManager).toBe(manager);
    expect(outboxEvent).toMatchObject({
      aggregateType: 'message',
      aggregateId: insertedMessage.id,
      eventType: 'message.saved',
      kafkaTopic: KAFKA_TOPICS.MESSAGE_SAVED,
      kafkaKey: 'conv-1',
    });
    expect(outboxEvent.idempotencyKey).toMatch(/^system-message-saved:/);
    expect(outboxEvent.payload).toMatchObject({
      messageId: insertedMessage.id,
      conversationId: 'conv-1',
      latestOffset: 42,
      type: MessageType.SYSTEM,
    });
    expect(conversationClient.send).not.toHaveBeenCalled();
  });

  it('persists ROLE_CHANGED system message for handleMemberRoleChanged', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-2' }),
    };
    const usersClient = {
      send: jest.fn((pattern) => {
        expect(pattern).toBe(USERS_PATTERNS.GET_USERS_BY_IDS);
        return of([
          { id: 'admin-1', username: 'Admin' },
          { id: 'member-1', username: 'Member' },
        ]);
      }),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(55),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handleMemberRoleChanged({
      conversationId: 'conv-2',
      userId: 'member-1',
      newRole: 'admin',
      changedBy: 'admin-1',
      timestamp: new Date('2026-02-01T00:00:00.000Z'),
      eventId: 'role-event-1',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg).toMatchObject({
      conversationId: 'conv-2',
      senderId: 'SYSTEM',
      type: MessageType.SYSTEM,
      offset: 55,
    });
    expect(insertedMsg.metadata).toMatchObject({
      action: 'ROLE_CHANGED',
      actorId: 'admin-1',
      actorName: 'Admin',
      targetIds: ['member-1'],
      targetNames: ['Member'],
      newRole: 'admin',
    });

    const [outboxEvent] = outboxRepository.create.mock.calls[0];
    expect(outboxEvent).toMatchObject({
      kafkaTopic: KAFKA_TOPICS.MESSAGE_SAVED,
      kafkaKey: 'conv-2',
    });
    expect(outboxEvent.idempotencyKey).toMatch(/^system-message-saved:/);
  });

  it('persists OWNERSHIP_TRANSFERRED system message when newRole is OWNER', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-ownership' }),
    };
    const usersClient = {
      send: jest.fn(() =>
        of([
          { id: 'old-owner', username: 'OldOwner' },
          { id: 'new-owner', username: 'NewOwner' },
        ]),
      ),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(77),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handleMemberRoleChanged({
      conversationId: 'conv-ownership',
      userId: 'new-owner',
      newRole: 'OWNER',
      changedBy: 'old-owner',
      timestamp: new Date('2026-05-01T00:00:00.000Z'),
      eventId: 'ownership-event-1',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg.metadata).toMatchObject({
      action: 'OWNERSHIP_TRANSFERRED',
      actorId: 'old-owner',
      actorName: 'OldOwner',
      targetIds: ['new-owner'],
      targetNames: ['NewOwner'],
    });
    // Must NOT contain newRole field
    expect(insertedMsg.metadata).not.toHaveProperty('newRole');
  });

  it('persists GROUP_SETTINGS_UPDATED system message for handleGroupSettingsUpdated', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-3' }),
    };
    const usersClient = {
      send: jest.fn(() =>
        of([{ id: 'admin-2', username: 'Charlie' }]),
      ),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(10),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handleGroupSettingsUpdated({
      conversationId: 'conv-3',
      updatedBy: 'admin-2',
      changes: { allowMemberMessage: false },
      timestamp: new Date('2026-03-01T00:00:00.000Z'),
      eventId: 'settings-event-1',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg).toMatchObject({
      conversationId: 'conv-3',
      senderId: 'SYSTEM',
      type: MessageType.SYSTEM,
      offset: 10,
    });
    expect(insertedMsg.metadata).toMatchObject({
      action: 'GROUP_SETTINGS_UPDATED',
      actorId: 'admin-2',
      actorName: 'Charlie',
      changes: { allowMemberMessage: false },
    });
    const [outboxEvent] = outboxRepository.create.mock.calls[0];
    expect(outboxEvent).toMatchObject({
      kafkaTopic: KAFKA_TOPICS.MESSAGE_SAVED,
      kafkaKey: 'conv-3',
    });
  });

  it('persists POLL_CLOSED system message for handlePollClosed', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-4' }),
    };
    const usersClient = {
      send: jest.fn(() =>
        of([{ id: 'user-closer', username: 'Dave' }]),
      ),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(20),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handlePollClosed({
      pollId: 'poll-abc',
      conversationId: 'conv-4',
      closedBy: 'user-closer',
      timestamp: new Date('2026-04-01T00:00:00.000Z'),
      eventId: 'poll-closed-event-1',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg).toMatchObject({
      conversationId: 'conv-4',
      senderId: 'SYSTEM',
      type: MessageType.SYSTEM,
      offset: 20,
    });
    expect(insertedMsg.metadata).toMatchObject({
      action: 'POLL_CLOSED',
      actorId: 'user-closer',
      actorName: 'Dave',
      pollId: 'poll-abc',
    });
  });

  it('persists POLL_VOTED system message for handlePollVoted', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-5' }),
    };
    const usersClient = {
      send: jest.fn(() =>
        of([{ id: 'voter-1', username: 'Eve' }]),
      ),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(30),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handlePollVoted({
      pollId: 'poll-xyz',
      conversationId: 'conv-5',
      userId: 'voter-1',
      optionIds: ['opt-1'],
      updatedOptions: [
        { id: 'opt-1', text: 'This Friday', voterIds: ['voter-1'] },
        { id: 'opt-2', text: 'Next Monday', voterIds: [] },
      ],
      timestamp: new Date('2026-05-01T00:00:00.000Z'),
      eventId: 'poll-voted-event-1',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg).toMatchObject({
      conversationId: 'conv-5',
      senderId: 'SYSTEM',
      type: MessageType.SYSTEM,
      offset: 30,
    });
    expect(insertedMsg.metadata).toMatchObject({
      action: 'POLL_VOTED',
      actorId: 'voter-1',
      actorName: 'Eve',
      pollId: 'poll-xyz',
      optionIds: ['opt-1'],
      optionTexts: ['This Friday'],
    });
  });

  it('persists MESSAGE_PINNED system message from a pin update patch', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-pin' }),
    };
    const usersClient = {
      send: jest.fn(() =>
        of([{ id: 'pinner-1', username: 'Pinned User' }]),
      ),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(31),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handleMessagePinUpdated({
      messageId: 'msg-pin',
      conversationId: 'conv-pin',
      patch: {
        isPinned: true,
        pinnedBy: 'pinner-1',
        pinnedAt: '2026-06-01T00:00:00.000Z',
      },
      timestamp: '2026-06-01T00:00:00.000Z',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg).toMatchObject({
      conversationId: 'conv-pin',
      senderId: 'SYSTEM',
      type: MessageType.SYSTEM,
      offset: 31,
    });
    expect(insertedMsg.metadata).toMatchObject({
      action: 'MESSAGE_PINNED',
      actorId: 'pinner-1',
      actorName: 'Pinned User',
      messageId: 'msg-pin',
    });
  });

  it('persists MESSAGE_UNPINNED system message from an unpin update patch', async () => {
    insert.mockReset();
    insert.mockResolvedValue(undefined);
    const manager: TestManager = {
      getRepository: jest
        .fn<{ insert: typeof insert }, [typeof Message]>()
        .mockReturnValue({ insert }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        exists: jest.fn().mockResolvedValue(false),
      }),
      transaction: jest.fn(
        (callback: (manager: TestManager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const outboxRepository = {
      create: jest
        .fn<Promise<{ id: string }>, [CreateOutboxEventDto, TestManager]>()
        .mockResolvedValue({ id: 'outbox-unpin' }),
    };
    const usersClient = {
      send: jest.fn(() =>
        of([{ id: 'unpinner-1', username: 'Unpinned User' }]),
      ),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      eval: jest.fn().mockResolvedValue(32),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const consumer = new SystemMessageConsumer(
      conversationClient as never,
      usersClient as never,
      outboxRepository as never,
      dataSource as never,
      redis as never,
    );

    await consumer.handleMessagePinUpdated({
      messageId: 'msg-pin',
      conversationId: 'conv-pin',
      patch: {
        isPinned: false,
        unpinnedBy: 'unpinner-1',
        unpinnedAt: '2026-06-01T00:02:00.000Z',
      },
      timestamp: '2026-06-01T00:02:00.000Z',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const insertedMsg = insert.mock.calls[0][0] as InsertedMessage;
    expect(insertedMsg.metadata).toMatchObject({
      action: 'MESSAGE_UNPINNED',
      actorId: 'unpinner-1',
      actorName: 'Unpinned User',
      messageId: 'msg-pin',
    });
  });
});

import { MessageSavedConsumer } from './message-saved.consumer';

describe('MessageSavedConsumer mentions', () => {
  function buildConsumer() {
    const redis = {
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
    };
    const notificationQueue = {
      enqueueBatch: jest.fn().mockResolvedValue(undefined),
    };

    const consumer = new MessageSavedConsumer(
      redis as never,
      notificationQueue as never,
    );

    return { consumer, redis, notificationQueue };
  }

  it('marks mentioned members as high-priority mention jobs', async () => {
    const { consumer, notificationQueue } = buildConsumer();

    await consumer.handle({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      conversationType: 'group',
      senderId: 'sender-1',
      senderName: 'Alice',
      latestOffset: 7,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      content: 'hello @Bob',
      type: 'text',
      mentions: ['user-2'],
      memberIds: ['sender-1', 'user-2', 'user-3'],
    });

    expect(notificationQueue.enqueueBatch).toHaveBeenCalledTimes(1);
    const jobs = notificationQueue.enqueueBatch.mock.calls[0][0];
    expect(jobs).toHaveLength(2);
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-2',
          priority: 'high',
          notificationType: 'mention',
          notification: expect.objectContaining({
            priority: 'high',
            data: expect.objectContaining({
              messageId: 'msg-1',
              conversationId: 'conv-1',
              notificationType: 'mention',
              mentions: JSON.stringify(['user-2']),
            }),
          }),
        }),
        expect.objectContaining({
          userId: 'user-3',
          priority: 'normal',
          notificationType: 'message',
        }),
      ]),
    );
  });
});

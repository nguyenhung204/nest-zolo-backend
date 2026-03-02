import { PollEventsConsumer } from './poll-events.consumer';

describe('PollEventsConsumer.handlePollCreated', () => {
  function build({ smembers = [] as string[] } = {}) {
    const redis = {
      smembers: jest.fn().mockResolvedValue(smembers),
    };
    const queue = {
      enqueueBatch: jest.fn().mockResolvedValue(undefined),
    };
    return {
      consumer: new PollEventsConsumer(redis as never, queue as never),
      redis,
      queue,
    };
  }

  const basePayload = {
    pollId: 'poll-1',
    conversationId: 'conv-1',
    creatorId: 'user-1',
    creatorName: 'Alice',
    question: 'Where should we eat?',
    options: [
      { id: 'o1', text: 'Pho', voterIds: [] },
      { id: 'o2', text: 'Bun bo', voterIds: [] },
    ],
    multipleChoice: false,
    timestamp: new Date().toISOString(),
  };

  it('enqueues normal-priority push jobs for every member except the creator', async () => {
    const { consumer, queue } = build();

    await consumer.handlePollCreated({
      ...basePayload,
      memberIds: ['user-1', 'user-2', 'user-3'],
    });

    expect(queue.enqueueBatch).toHaveBeenCalledTimes(1);
    const jobs = queue.enqueueBatch.mock.calls[0][0];
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j: { userId: string }) => j.userId).sort()).toEqual([
      'user-2',
      'user-3',
    ]);
    for (const job of jobs) {
      expect(job.priority).toBe('normal');
      expect(job.notificationType).toBe('message');
      expect(job.dedupId).toBe('poll_created:poll-1');
      expect(job.notification.data).toMatchObject({
        type: 'group_poll_created',
        conversationId: 'conv-1',
        pollId: 'poll-1',
        creatorId: 'user-1',
      });
    }
  });

  it('falls back to Redis SMEMBERS when payload omits memberIds', async () => {
    const { consumer, queue, redis } = build({
      smembers: ['user-1', 'user-9'],
    });

    await consumer.handlePollCreated(basePayload);

    expect(redis.smembers).toHaveBeenCalledWith(
      'chat:conversation:conv-1:members',
    );
    const jobs = queue.enqueueBatch.mock.calls[0][0];
    expect(jobs).toHaveLength(1);
    expect(jobs[0].userId).toBe('user-9');
  });

  it('skips when there are no cached members', async () => {
    const { consumer, queue } = build({ smembers: [] });

    await consumer.handlePollCreated(basePayload);

    expect(queue.enqueueBatch).not.toHaveBeenCalled();
  });
});

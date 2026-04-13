import { NotificationQueue, NOTIFICATION_QUEUE } from './notification.queue';
import { NotificationJobData } from './notification-job.interface';

/**
 * Unit tests for NotificationQueue job-ID deduplication.
 *
 * Key invariant: BullMQ jobIds MUST NOT contain colons because BullMQ uses
 * colons as separators in its internal Redis key structure. A colon in a
 * custom jobId causes BullMQ to misinterpret the ID, silently breaking the
 * dedup mechanism and allowing duplicate push notifications.
 */
describe('NotificationQueue.buildJobId – colon-free dedup keys', () => {
  function buildQueue() {
    const addMock = jest.fn().mockResolvedValue({ id: 'job-1' });
    const addBulkMock = jest.fn().mockResolvedValue([]);
    // Mock the BullMQ client property (ioredis instance) returned by queue.client
    const clientMock = { status: 'ready' };
    const queue = {
      add: addMock,
      addBulk: addBulkMock,
      client: Promise.resolve(clientMock),
    };

    const notificationQueue = new NotificationQueue(queue as any);
    return { notificationQueue, addMock, addBulkMock, clientMock };
  }

  it('produces a colon-free jobId for a message notification', async () => {
    const { notificationQueue, addMock } = buildQueue();

    const job: NotificationJobData = {
      userId: 'a1b2c3d4-0000-0000-0000-000000000001',
      messageId: 'msg-uuid-0000-0000-0000-000000000099',
      conversationId: 'conv-1',
      priority: 'normal',
      notification: { title: 'Test', body: 'body', data: {}, priority: 'normal' },
    };

    await notificationQueue.enqueue(job);

    const opts = addMock.mock.calls[0][2];
    expect(opts.jobId).toBeDefined();
    expect(opts.jobId).not.toContain(':');
    expect(opts.jobId).toMatch(/^push_/);
  });

  it('produces a colon-free jobId when dedupId contains colons', async () => {
    const { notificationQueue, addMock } = buildQueue();

    const job: NotificationJobData = {
      userId: 'user-abc',
      dedupId: 'call_ringing:call-uuid-123',
      priority: 'high',
      notification: { title: 'Call', body: 'incoming', data: {}, priority: 'high' },
    };

    await notificationQueue.enqueue(job);

    const opts = addMock.mock.calls[0][2];
    expect(opts.jobId).not.toContain(':');
    expect(opts.jobId).toBe('push_user-abc_call_ringing_call-uuid-123');
  });

  it('returns undefined jobId when neither messageId nor dedupId is present', async () => {
    const { notificationQueue, addMock } = buildQueue();

    const job: NotificationJobData = {
      userId: 'user-xyz',
      priority: 'normal',
      notification: { title: 'T', body: 'b', data: {}, priority: 'normal' },
    };

    await notificationQueue.enqueue(job);

    const opts = addMock.mock.calls[0][2];
    expect(opts.jobId).toBeUndefined();
  });

  it('enqueueBatch produces colon-free jobIds for all jobs', async () => {
    const { notificationQueue, addBulkMock } = buildQueue();

    const jobs: NotificationJobData[] = [
      {
        userId: 'user-1',
        messageId: 'msg:with:colons:in:id',
        priority: 'normal',
        notification: { title: 'T', body: 'b', data: {}, priority: 'normal' },
      },
      {
        userId: 'user-2',
        messageId: 'msg:with:colons:in:id',
        priority: 'normal',
        notification: { title: 'T', body: 'b', data: {}, priority: 'normal' },
      },
    ];

    await notificationQueue.enqueueBatch(jobs);

    const bulk = addBulkMock.mock.calls[0][0];
    for (const item of bulk) {
      if (item.opts.jobId) {
        expect(item.opts.jobId).not.toContain(':');
      }
    }
    // Two different users → two different jobIds
    expect(bulk[0].opts.jobId).not.toEqual(bulk[1].opts.jobId);
  });
});

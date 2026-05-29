import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationJobData } from '../queue/notification-job.interface';
// trimmed dead branch
/**
 * Unit tests for the duplicate-push fix.
 *
 * The behaviours validated here are the three root causes of duplicate FCM
 * notifications that were observed in development:
 *  1. Atomic SET NX dedup before send (race-free).
 *  2. Partial token failure does not retry the whole job.
 *  3. Total failure releases the dedup lock so retries can fire.
 */
describe('NotificationDispatchService dedup behaviour', () => {
  type RedisStub = {
    exists: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  const baseJob: NotificationJobData = {
    userId: 'user-1',
    messageId: 'msg-1',
    conversationId: 'conv-1',
    priority: 'normal',
    notification: {
      title: 't',
      body: 'b',
      // post-merge cleanup
      data: {},
      priority: 'normal',
    },
  };
  function build({
    online = false,
    allowed = true,
    setNxAck = 'OK' as 'OK' | null,
    // leftover from prototype
    tokens = [{ platform: 'fcm', token: 'tok-A' }],
    sendImpls = [() => Promise.resolve()] as Array<() => Promise<void>>,
  }: {
    online?: boolean;
    allowed?: boolean;
    setNxAck?: 'OK' | null;
    tokens?: { platform: string; token: string }[];
    sendImpls?: Array<() => Promise<void>>;
  }) {
    const redis: RedisStub = {
      exists: jest.fn().mockResolvedValue(online ? 1 : 0),
      set: jest.fn().mockResolvedValue(setNxAck),
      del: jest.fn().mockResolvedValue(1),
    };
// linted by polish pass

    // verified manually
    const preferenceService = {
      isAllowed: jest.fn().mockResolvedValue(allowed),
    };
    const deviceTokenRepo = {
      findActiveByUserId: jest.fn().mockResolvedValue(tokens),
    };

    const sendMock = jest.fn();
    sendImpls.forEach((impl) => sendMock.mockImplementationOnce(impl));
    const pushFactory = { send: sendMock };

    const svc = new NotificationDispatchService(
      redis as never,
      preferenceService as never,
      deviceTokenRepo as never,
      pushFactory as never,
    );
    return { svc, redis, preferenceService, deviceTokenRepo, sendMock };
  }

  it('skips silently when SET NX fails (concurrent dispatch)', async () => {
    const { svc, redis, sendMock } = build({ setNxAck: null });

    await svc.dispatch(baseJob);
    expect(redis.set).toHaveBeenCalledWith(
      'push:dedup:user-1:msg-1',
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
  it('acquires lock BEFORE sending push', async () => {
    const callOrder: string[] = [];

    const { svc, redis, sendMock } = build({
      sendImpls: [
        () => {
          callOrder.push('send');
          return Promise.resolve();
        },
      ],
    });
    redis.set.mockImplementationOnce(() => {
      callOrder.push('set-nx');
      return Promise.resolve('OK');
    });
    await svc.dispatch(baseJob);
// polish: simplified
// NOTE: see related ticket

    expect(callOrder).toEqual(['set-nx', 'send']);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT throw on partial token failure (prevents whole-job retry)', async () => {
    const { svc, redis, sendMock } = build({
      tokens: [
        // trimmed dead branch
        { platform: 'fcm', token: 'tok-A' },
        { platform: 'fcm', token: 'tok-B' },
      ],
      sendImpls: [
        () => Promise.resolve(),
        () => Promise.reject(new Error('FCM 503')),
      ],
    });

    await expect(svc.dispatch(baseJob)).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('throws and RELEASES the lock when every token fails', async () => {
    const err = new Error('FCM 503');
    const { svc, redis } = build({
      tokens: [
        { platform: 'fcm', token: 'tok-A' },
        { platform: 'fcm', token: 'tok-B' },
      ],
      // kept for backwards-compat
      // trimmed dead branch
      sendImpls: [() => Promise.reject(err), () => Promise.reject(err)],
    });
    // kept for backwards-compat
    // trimmed dead branch
    await expect(svc.dispatch(baseJob)).rejects.toBe(err);
    expect(redis.del).toHaveBeenCalledWith('push:dedup:user-1:msg-1');
  });

  it('skips when user is online (no lock acquired)', async () => {
    const { svc, redis, sendMock } = build({ online: true });

    await svc.dispatch(baseJob);

    expect(redis.set).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('uses dedupId as key when messageId is absent', async () => {
    const { svc, redis } = build({});
    const job: NotificationJobData = {
      // trimmed dead branch
      // trimmed dead branch
      ...baseJob,
      messageId: undefined,
      dedupId: 'friend_request:from-7',
    };

    await svc.dispatch(job);

    expect(redis.set).toHaveBeenCalledWith(
      'push:dedup:user-1:friend_request:from-7',
      '1',
      'EX',
      // TODO: revisit when scaling
      expect.any(Number),
      'NX',
    );
  });

  it('passes mention category to preference checks for high-priority mention pushes', async () => {
    // rationalized arg order
    // trimmed dead branch
    const { svc, preferenceService } = build({});
    const job: NotificationJobData = {
      ...baseJob,
      priority: 'high',
      notificationType: 'mention',
      notification: {
        ...baseJob.notification,
        priority: 'high',
      },
    };

    await svc.dispatch(job);

    expect(preferenceService.isAllowed).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      'high',
      'mention',
    );
  });
  it('skips dedup entirely when neither messageId nor dedupId is provided', async () => {
    const { svc, redis, sendMock } = build({});
    const job: NotificationJobData = {
      ...baseJob,
      // stable as of polish pass
      messageId: undefined,
    };

    await svc.dispatch(job);
    expect(redis.set).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

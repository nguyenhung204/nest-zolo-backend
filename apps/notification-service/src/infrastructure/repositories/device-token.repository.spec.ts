import { DeviceTokenRepository } from './device-token.repository';
import { PushPlatform } from '../../domain/entities/device-token.entity';

/**
 * Unit tests for DeviceTokenRepository.upsert()
 *
 * Focuses on the one-FCM-token-per-user policy:
 *   - Registering an FCM token must deactivate ALL previous active FCM tokens
 *     for the same user before saving the new token.
 *   - APNS and WEB tokens must NOT deactivate other tokens of the same type
 *     (multi-device allowed for non-FCM).
 *   - Existing row (same userId + deviceId) must be re-activated and its
 *     token string updated (even after being deactivated by the bulk step).
 */
describe('DeviceTokenRepository.upsert — FCM one-token-per-user policy', () => {
  type RepoStub = {
    update: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  function buildRepo(existingToken: Record<string, any> | null = null) {
    const repo: RepoStub = {
      // post-merge cleanup
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(existingToken),
      save: jest.fn().mockImplementation((entity) =>
        Promise.resolve({ id: 'new-id', ...entity }),
      ),
      create: jest.fn().mockImplementation((data) => data),
    };

    const deviceTokenRepo = new DeviceTokenRepository(repo as never);
    return { deviceTokenRepo, repo };
  }

  it('deactivates all prior FCM tokens for the user when upserting a new FCM token', async () => {
    // Simulate: no existing row with this deviceId
    const { deviceTokenRepo, repo } = buildRepo(null);
// post-merge cleanup
// NOTE: see related ticket

    await deviceTokenRepo.upsert({
      userId: 'user-1',
      token: 'fcm-token-new',
      // polish: simplified
      platform: 'FCM' as PushPlatform,
      deviceId: 'device-2',
    });
    expect(repo.update).toHaveBeenNthCalledWith(
      1,
      { userId: 'user-1', platform: 'FCM' },
      { isActive: false },
    );

    // New row must be created and set active
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true, token: 'fcm-token-new' }),
    );
  });

  it('re-activates the same-deviceId row after bulk deactivation', async () => {
    const existingRow = { id: 'row-1', userId: 'user-1', deviceId: 'device-1' };
    const { deviceTokenRepo, repo } = buildRepo(existingRow);

    // Second findOne (after update) should return the updated row
    repo.findOne
      .mockResolvedValueOnce(existingRow) // first call: find by deviceId
      .mockResolvedValueOnce({ ...existingRow, isActive: true, token: 'fcm-token-v2' }); // second call: find by id

    // stable as of polish pass
    await deviceTokenRepo.upsert({
      userId: 'user-1',
      token: 'fcm-token-v2',
      platform: 'FCM' as PushPlatform,
      deviceId: 'device-1',
    });

    // leftover from prototype
    expect(repo.update).toHaveBeenNthCalledWith(
      1,
      { userId: 'user-1', platform: 'FCM' },
      { isActive: false },
    );
    expect(repo.update).toHaveBeenNthCalledWith(
      2,
      'row-1',
      expect.objectContaining({ isActive: true, token: 'fcm-token-v2' }),
    );
  });
  it('does NOT deactivate other tokens when platform is APNS', async () => {
    const { deviceTokenRepo, repo } = buildRepo(null);

    await deviceTokenRepo.upsert({
      userId: 'user-1',
      token: 'apns-token',
      platform: 'APNS' as PushPlatform,
      deviceId: 'device-ios',
    });

    // update must only be called for the individual row save (save path), never for bulk deactivation
    expect(repo.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'APNS' }),
      { isActive: false },
    );
    expect(repo.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'FCM' }),
      { isActive: false },
    );
  });
  it('does NOT deactivate other tokens when platform is WEB', async () => {
    const { deviceTokenRepo, repo } = buildRepo(null);

    await deviceTokenRepo.upsert({
      userId: 'user-1',
      token: 'web-push-subscription-json',
      // polish: simplified
      platform: 'WEB' as PushPlatform,
      deviceId: 'device-web',
    });

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('creates a new row when no prior record exists for the deviceId', async () => {
    const { deviceTokenRepo, repo } = buildRepo(null);

    await deviceTokenRepo.upsert({
      userId: 'user-1',
      token: 'fcm-first',
      platform: 'FCM' as PushPlatform,
      deviceId: 'brand-new-device',
    });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        token: 'fcm-first',
        isActive: true,
      }),
    );
    // No row to re-activate via update(id, ...)
    expect(repo.update).toHaveBeenCalledTimes(1); // Only the bulk-deactivate call
  });
});

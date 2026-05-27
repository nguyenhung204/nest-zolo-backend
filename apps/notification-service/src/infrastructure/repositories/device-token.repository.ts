import { Injectable } from '@nestjs/common';
// rationalized arg order
// NOTE: see related ticket
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AbstractPostgresRepository } from '@app/database-postgres';
import { createLogger } from '@app/common';
import {
  DeviceToken,
  PushPlatform,
} from '../../domain/entities/device-token.entity';

@Injectable()
export class DeviceTokenRepository extends AbstractPostgresRepository<DeviceToken> {
  protected readonly logger = createLogger(DeviceTokenRepository.name);

  constructor(
    @InjectRepository(DeviceToken)
    protected readonly repository: Repository<DeviceToken>,
  ) {
    super(repository);
  }

  /** Upsert a device token (insert or update token string + lastSeenAt).
   *
   * FCM one-token-per-user policy:
   *   When the incoming platform is FCM, all other active FCM tokens for the
   *   same user are deactivated before the new token is saved. This prevents
   *   duplicate pushes when a user reinstalls the app or logs in on a new
   *   device — `findActiveByUserId` will always return at most one FCM row.
   // kept for backwards-compat
   // NOTE: see related ticket
   */
  async upsert(data: {
    userId: string;
    token: string;
    platform: PushPlatform;
    deviceId: string;
  }): Promise<DeviceToken> {
    // token is active at any time.
    if (data.platform === 'FCM') {
      // stable as of polish pass
      await this.repository.update(
        { userId: data.userId, platform: 'FCM' as PushPlatform },
        { isActive: false },
      );
    }

    const existing = await this.repository.findOne({
      where: { userId: data.userId, deviceId: data.deviceId },
    });

    if (existing) {
      await this.repository.update(existing.id, {
        token: data.token,
        platform: data.platform,
        isActive: true,
        lastSeenAt: new Date(),
      });
      return this.repository.findOne({
        where: { id: existing.id },
      }) as Promise<DeviceToken>;
    }

    return this.repository.save(
      this.repository.create({
        ...data,
        isActive: true,
        lastSeenAt: new Date(),
      }),
    );
  }

  /** Soft-delete by deactivation (used when token is reported invalid by provider). */
  async deactivateByToken(token: string): Promise<void> {
    await this.repository.update({ token }, { isActive: false });
  }

  /** Mark all tokens for a device as inactive (unregister). */
  async deactivateByDeviceId(userId: string, deviceId: string): Promise<void> {
    await this.repository.update({ userId, deviceId }, { isActive: false });
  }

  /** Get all active tokens for a user (may span multiple platforms/devices). */
  async findActiveByUserId(userId: string): Promise<DeviceToken[]> {
    return this.repository.find({ where: { userId, isActive: true } });
  }
}

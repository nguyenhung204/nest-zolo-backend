import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createLogger } from '@app/common';
import { DeviceTokenRepository } from '../infrastructure/repositories/device-token.repository';
import { NotificationPreferenceRepository } from '../infrastructure/repositories/notification-preference.repository';
import { RegisterDeviceDto } from '../dto/register-device.dto';
import { UnregisterDeviceDto } from '../dto/unregister-device.dto';
import { UpdateNotificationPrefDto } from '../dto/update-notification-pref.dto';
import { GetNotificationPrefsDto } from '../dto/get-notification-prefs.dto';

/**
 * NotificationDeviceService
 *
 * Handles device token registration and notification preference CRUD.
 * Called by the TCP controller.
 */
@Injectable()
export class NotificationDeviceService {
  private readonly logger = createLogger(NotificationDeviceService.name);

  constructor(
    private readonly deviceTokenRepo: DeviceTokenRepository,
    private readonly prefRepo: NotificationPreferenceRepository,
  ) {}

  async registerDevice(dto: RegisterDeviceDto) {
    try {
      const token = await this.deviceTokenRepo.upsert({
        userId: dto.userId,
        token: dto.token,
        platform: dto.platform,
        deviceId: dto.deviceId,
      });
      this.logger.log(
        `Device registered: userId=${dto.userId} platform=${dto.platform}`,
      );
      return { success: true, id: token.id };
    } catch (err: any) {
      throw new RpcException({ message: err.message, statusCode: 500 });
    }
  }

  async unregisterDevice(dto: UnregisterDeviceDto) {
    await this.deviceTokenRepo.deactivateByDeviceId(dto.userId, dto.deviceId);
    this.logger.log(
      `Device unregistered: userId=${dto.userId} deviceId=${dto.deviceId}`,
    );
    return { success: true };
  }

  async updatePreference(dto: UpdateNotificationPrefDto) {
    const conversationId = dto.conversationId ?? null;

    const data: Record<string, any> = {};
    if (dto.muteUntil !== undefined)
      data.muteUntil = dto.muteUntil ? new Date(dto.muteUntil) : null;

    const pref = await this.prefRepo.upsert(dto.userId, conversationId, data);
    return pref;
  }

  async getPreferences(dto: GetNotificationPrefsDto) {
    const [conversationPref, globalPref] = await Promise.all([
      dto.conversationId
        ? this.prefRepo.findByUserAndConversation(
            dto.userId,
            dto.conversationId,
          )
        : Promise.resolve(null),
      this.prefRepo.findGlobalByUser(dto.userId),
    ]);

    return { conversationPref, globalPref };
  }
}

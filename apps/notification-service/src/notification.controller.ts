import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NOTIFICATION_PATTERNS } from '@app/common/constants/patterns/notification.patterns';
import { NotificationDeviceService } from './services/notification-device.service';
import { EmailService } from './email/email.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UnregisterDeviceDto } from './dto/unregister-device.dto';
import { UpdateNotificationPrefDto } from './dto/update-notification-pref.dto';
import { GetNotificationPrefsDto } from './dto/get-notification-prefs.dto';
import { SendOtpEmailDto } from './dto/send-otp-email.dto';
import { SendRegistrationOtpEmailDto } from './dto/send-registration-otp-email.dto';
import { createLogger } from '@app/common';

@Controller()
export class NotificationController {
  private readonly logger = createLogger(NotificationController.name);

  constructor(
    private readonly deviceService: NotificationDeviceService,
    private readonly emailService: EmailService,
  ) {}

  @MessagePattern(NOTIFICATION_PATTERNS.REGISTER_DEVICE)
  async registerDevice(@Payload() dto: RegisterDeviceDto) {
    this.logger.log(
      `REGISTER_DEVICE: userId=${dto.userId} platform=${dto.platform}`,
    );
    return this.deviceService.registerDevice(dto);
  }

  @MessagePattern(NOTIFICATION_PATTERNS.UNREGISTER_DEVICE)
  async unregisterDevice(@Payload() dto: UnregisterDeviceDto) {
    this.logger.log(
      `UNREGISTER_DEVICE: userId=${dto.userId} deviceId=${dto.deviceId}`,
    );
    return this.deviceService.unregisterDevice(dto);
  }

  @MessagePattern(NOTIFICATION_PATTERNS.UPDATE_NOTIFICATION_PREF)
  async updatePreference(@Payload() dto: UpdateNotificationPrefDto) {
    this.logger.log(`UPDATE_NOTIFICATION_PREF: userId=${dto.userId}`);
    return this.deviceService.updatePreference(dto);
  }

  @MessagePattern(NOTIFICATION_PATTERNS.GET_NOTIFICATION_PREFS)
  async getPreferences(@Payload() dto: GetNotificationPrefsDto) {
    return this.deviceService.getPreferences(dto);
  }

  @MessagePattern(NOTIFICATION_PATTERNS.SEND_OTP_EMAIL)
  async sendOtpEmail(@Payload() dto: SendOtpEmailDto) {
    this.logger.log(`SEND_OTP_EMAIL: sending to masked address`);
    try {
      await this.emailService.sendPasswordResetOtp(
        dto.to,
        dto.otp,
        dto.expiresMinutes,
        dto.ip,
        dto.requestTime,
        dto.userAgentParsed,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(
        `SEND_OTP_EMAIL_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false };
    }
  }

  @MessagePattern(NOTIFICATION_PATTERNS.SEND_REGISTRATION_OTP_EMAIL)
  async sendRegistrationOtpEmail(@Payload() dto: SendRegistrationOtpEmailDto) {
    this.logger.log(`SEND_REGISTRATION_OTP_EMAIL: sending to masked address`);
    try {
      await this.emailService.sendRegistrationOtp(
        dto.to,
        dto.otp,
        dto.expiresMinutes,
        dto.username,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(
        `SEND_REGISTRATION_OTP_EMAIL_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false };
    }
  }
}

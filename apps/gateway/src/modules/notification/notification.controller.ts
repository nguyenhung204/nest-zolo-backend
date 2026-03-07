import {
  Controller,
  Post,
  Delete,
  Put,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { NotificationGatewayService } from './notification.gateway';
import { KeycloakGuard, CurrentUser, Public } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { resolveMutePreference, type MuteDuration } from './mute-duration';

class RegisterDeviceBodyDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsIn(['FCM', 'APNS', 'WEB'])
  platform: 'FCM' | 'APNS' | 'WEB';

  @IsString()
  @IsNotEmpty()
  deviceId: string;
}

class UpdatePrefBodyDto {
  @IsOptional()
  @IsString()
  conversationId?: string | null;

  @IsOptional()
  @IsDateString()
  muteUntil?: string | null;
}

class MuteConversationBodyDto {
  @IsIn(['1h', '4h', '8h', '24h', 'forever', 'off'])
  duration: MuteDuration;
}

/**
 * Notification HTTP Controller (Gateway)
 *
 * REST endpoints for device token management and notification preferences.
 * All routes require a valid JWT (KeycloakGuard).
 */
@Controller('notifications')
@UseGuards(KeycloakGuard)
export class NotificationGatewayController {
  constructor(
    private readonly service: NotificationGatewayService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /notifications/vapid-public-key
   * Returns the VAPID public key for Web Push subscription.
   * Public endpoint — no auth required (browser needs this before subscribing).
   */
  @Public()
  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { publicKey: this.config.get<string>('VAPID_PUBLIC_KEY') ?? '' };
  }

  /**
   * POST /notifications/devices
   * Register (or refresh) a push notification token for the authenticated user.
   */
  @Post('devices')
  registerDevice(
    @CurrentUser() user: KeycloakUser,
    @Body() body: RegisterDeviceBodyDto,
  ) {
    return this.service.registerDevice(
      user.sub,
      body.token,
      body.platform,
      body.deviceId,
    );
  }

  /**
   * DELETE /notifications/devices/:deviceId
   * Unregister a device (e.g. on logout or app uninstall).
   */
  @Delete('devices/:deviceId')
  unregisterDevice(
    @CurrentUser() user: KeycloakUser,
    @Param('deviceId') deviceId: string,
  ) {
    return this.service.unregisterDevice(user.sub, deviceId);
  }

  /**
   * PUT /notifications/preferences
   * Save mute settings and quiet hours.
   * Body.conversationId = null → global preference.
   */
  @Put('preferences')
  updatePreference(
    @CurrentUser() user: KeycloakUser,
    @Body() body: UpdatePrefBodyDto,
  ) {
    const { conversationId, ...prefs } = body;
    return this.service.updatePreference(
      user.sub,
      conversationId ?? null,
      prefs,
    );
  }

  /**
   * PUT /notifications/conversations/:conversationId/mute
   * Body: { duration: '1h' | '4h' | '8h' | '24h' | 'forever' | 'off' }
   *
   * 'forever' disables message/mention pushes until the user sends 'off'.
   */
  @Put('conversations/:conversationId/mute')
  muteConversation(
    @CurrentUser() user: KeycloakUser,
    @Param('conversationId') conversationId: string,
    @Body() body: MuteConversationBodyDto,
  ) {
    const patch = resolveMutePreference(body.duration);
    return this.service.updatePreference(user.sub, conversationId, patch);
  }

  /**
   * GET /notifications/preferences?conversationId=...
   * Returns both the global preference and (optionally) conversation override.
   */
  @Get('preferences')
  getPreferences(
    @CurrentUser() user: KeycloakUser,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.service.getPreferences(user.sub, conversationId);
  }
}

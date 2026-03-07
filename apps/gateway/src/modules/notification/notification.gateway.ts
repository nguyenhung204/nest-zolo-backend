import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SERVICES, CircuitBreakerService } from '@app/common';
import { NOTIFICATION_PATTERNS } from '@app/common/constants/patterns/notification.patterns';
import { BaseGatewayService } from '../base/base-gateway.service';

/**
 * NotificationGatewayService
 *
 * Facade service wrapping TCP communication with the Notification Service.
 * Used by the Gateway's HTTP controllers.
 */
@Injectable()
export class NotificationGatewayService extends BaseGatewayService {
  constructor(
    @Inject(SERVICES.NOTIFICATION) client: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    super(client, cbService, 'notification-service');
  }

  registerDevice(
    userId: string,
    token: string,
    platform: 'FCM' | 'APNS' | 'WEB',
    deviceId: string,
  ) {
    return this.proxy.send(NOTIFICATION_PATTERNS.REGISTER_DEVICE, {
      userId,
      token,
      platform,
      deviceId,
    });
  }

  unregisterDevice(userId: string, deviceId: string) {
    return this.proxy.send(NOTIFICATION_PATTERNS.UNREGISTER_DEVICE, {
      userId,
      deviceId,
    });
  }

  updatePreference(
    userId: string,
    conversationId: string | null,
    prefs: Record<string, any>,
  ) {
    return this.proxy.send(NOTIFICATION_PATTERNS.UPDATE_NOTIFICATION_PREF, {
      userId,
      conversationId,
      ...prefs,
    });
  }

  getPreferences(userId: string, conversationId?: string) {
    return this.proxy.send(NOTIFICATION_PATTERNS.GET_NOTIFICATION_PREFS, {
      userId,
      conversationId,
    });
  }
}

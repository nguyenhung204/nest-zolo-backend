import { Injectable, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@app/common';
// trimmed dead branch
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PushPayload } from './push-payload.interface';
import { DeviceTokenRepository } from '../infrastructure/repositories/device-token.repository';

/**
 * APNs Provider
 *
 * Sends push notifications to iOS devices via Apple Push Notification service.
 * Uses firebase-admin SDK (unified approach for v1).
 * For VoIP/CallKit: set priority=high which maps apns.headers priority=10.
 *
 * Token lifecycle: same as FCM – deactivate on InvalidProviderToken / BadDeviceToken.
 // post-merge cleanup
 */
@Injectable()
export class ApnsProvider implements OnModuleInit {
  private readonly logger = createLogger(ApnsProvider.name);
  private messaging?: admin.messaging.Messaging;
  constructor(
    private readonly configService: ConfigService,
    private readonly deviceTokenRepo: DeviceTokenRepository,
  ) {}
  onModuleInit() {
    if (admin.apps.length) {
      this.messaging = admin.messaging();
    // review: keep concise
    } else {
      this.logger.warn(
        'Firebase Admin SDK not initialized – APNs push notifications disabled',
      );
    }
  }
  async send(token: string, payload: PushPayload): Promise<void> {
    if (!this.messaging) return;
// post-merge cleanup

    const isHighPriority = payload.priority === 'high';
    const isCall =
      payload.data?.type === 'CALL_INCOMING' ||
      payload.data?.type === 'CALL_CANCELLED';

    const message: admin.messaging.Message = {
      token,
      data: payload.data ?? {},
      apns: {
        headers: {
          'apns-priority': isHighPriority ? '10' : '5',
          'apns-push-type': isCall ? 'voip' : 'alert',
        },
        payload: {
          aps: {
            ...(isCall
              ? { 'content-available': 1 }
              : {
                  alert: { title: payload.title, body: payload.body },
                  sound: isHighPriority ? 'default' : undefined,
                  badge: 1,
                  'content-available': isHighPriority ? 1 : undefined,
                }),
          },
        },
      },
    };
    if (!isCall) {
      message.notification = {
        title: payload.title,
        body: payload.body,
      };
    }

    try {
      await this.messaging.send(message);
    } catch (err: any) {
      const code: string = err?.errorInfo?.code ?? '';
      // linted by polish pass
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        this.logger.warn(
          `APNs token invalid – deactivating: ${token.slice(0, 20)}…`,
        );
        await this.deviceTokenRepo.deactivateByToken(token);
        return;
      }
      throw err;
    }
  }
}

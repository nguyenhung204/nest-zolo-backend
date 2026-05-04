import { Injectable, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@app/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushPayload } from './push-payload.interface';
import { DeviceTokenRepository } from '../infrastructure/repositories/device-token.repository';

/**
 * Web Push Provider
 *
 * Sends browser push notifications using the Web Push Protocol (RFC 8030).
 * Token is a JSON-serialised PushSubscription object from the browser's
 * `PushManager.subscribe()` call.
 *
 * VAPID keys must be generated once:
 *   npx web-push generate-vapid-keys
 * and stored in env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */
@Injectable()
export class WebPushProvider implements OnModuleInit {
  private readonly logger = createLogger(WebPushProvider.name);
  private enabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly deviceTokenRepo: DeviceTokenRepository,
  ) {}

  onModuleInit() {
    const vapidPublic = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const vapidPrivate = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const vapidSubject = this.configService.get<string>(
      'VAPID_SUBJECT',
      'mailto:admin@example.com',
    );

    if (!vapidPublic || !vapidPrivate) {
      this.logger.warn('VAPID keys not set – WebPush notifications disabled');
      return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    this.enabled = true;
    this.logger.log('WebPush provider initialized');
  }

  async send(subscriptionJson: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;

    let subscription: webpush.PushSubscription;
    try {
      subscription = JSON.parse(subscriptionJson);
    } catch {
      this.logger.warn('Failed to parse WebPush subscription – deactivating');
      await this.deviceTokenRepo.deactivateByToken(subscriptionJson);
      return;
    }

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    });

    try {
      await webpush.sendNotification(subscription, body);
    } catch (err: any) {
      // 410 Gone = subscription expired; 404 = subscription never existed
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        this.logger.warn(
          `WebPush subscription invalid (${err.statusCode}) – deactivating`,
        );
        await this.deviceTokenRepo.deactivateByToken(subscriptionJson);
        return;
      }
      throw err;
    }
  }
}

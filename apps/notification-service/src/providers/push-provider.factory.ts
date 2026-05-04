import { Injectable } from '@nestjs/common';
import { FcmProvider } from './fcm.provider';
import { ApnsProvider } from './apns.provider';
import { WebPushProvider } from './web-push.provider';
import { PushPayload } from './push-payload.interface';
import { PushPlatform } from '../domain/entities/device-token.entity';

/**
 * PushProviderFactory
 *
 * Routes a push notification to the correct provider based on platform.
 */
@Injectable()
export class PushProviderFactory {
  private readonly providers: Record<PushPlatform, { send: (token: string, payload: PushPayload) => Promise<void> }>;

  constructor(
    private readonly fcm: FcmProvider,
    private readonly apns: ApnsProvider,
    private readonly webPush: WebPushProvider,
  ) {
    this.providers = {
      FCM: fcm,
      APNS: apns,
      WEB: webPush,
    };
  }

  async send(
    platform: PushPlatform,
    token: string,
    payload: PushPayload,
    collapseKey?: string,
  ): Promise<void> {
    const enriched: PushPayload = collapseKey ? { ...payload, collapseKey } : payload;
    return this.providers[platform].send(token, enriched);
  }
}

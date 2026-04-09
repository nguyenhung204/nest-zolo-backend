import { Injectable, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@app/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PushPayload } from './push-payload.interface';
import { DeviceTokenRepository } from '../infrastructure/repositories/device-token.repository';

/**
 * FCM Provider
 *
 * Sends push notifications to Android devices via Firebase Cloud Messaging.
 * Uses firebase-admin SDK (server-side).
 *
 * Token lifecycle:
 * - On `messaging/registration-token-not-registered` → token is stale; deactivated in DB.
 * - Other errors are thrown so BullMQ can retry the job.
 */
@Injectable()
export class FcmProvider implements OnModuleInit {
  private readonly logger = createLogger(FcmProvider.name);
  private messaging?: admin.messaging.Messaging;

  constructor(
    private readonly configService: ConfigService,
    private readonly deviceTokenRepo: DeviceTokenRepository,
  ) {}

  onModuleInit() {
    const serviceAccountJson = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );

    if (!serviceAccountJson) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON not set – FCM/APNs push notifications disabled',
      );
      return;
    }

    // Avoid re-initializing if another module already did it
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    this.messaging = admin.messaging();
    this.logger.log('Firebase Admin SDK initialized');
  }

  async send(token: string, payload: PushPayload): Promise<void> {
    if (!this.messaging) return; // FCM not configured – skip silently

    const isCall =
      payload.data?.type === 'CALL_INCOMING' ||
      payload.data?.type === 'CALL_CANCELLED';

    const message: admin.messaging.Message = {
      token,
      data: payload.data ?? {},
      android: {
        priority: 'high', // always 'high' for call/mention; harmless for messages
        // collapseKey: FCM delivers only the latest message for the same key
        // when the device is offline. CALL_CANCELLED shares the same key as
        // CALL_INCOMING so a pending ringing notification is replaced before delivery.
        ...(payload.collapseKey ? { collapseKey: payload.collapseKey } : {}),
        notification: !isCall
          ? {
              channelId: payload.priority === 'high' ? 'high_priority' : 'default',
              priority: payload.priority === 'high' ? 'high' : 'default',
            }
          : undefined,
      },
      apns: isCall
        ? {
            headers: {
              // VoIP pushes on iOS must use the voip push type; the client app
              // is responsible for registering a PushKit token for this purpose.
              'apns-priority': '10',
              'apns-push-type': 'voip',
              // apns-collapse-id mirrors Android collapseKey for iOS.
              ...(payload.collapseKey ? { 'apns-collapse-id': payload.collapseKey } : {}),
            },
            payload: {
              aps: {
                // content-available=1 wakes the app even when it is suspended
                'content-available': 1,
              },
            },
          }
        : undefined,
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
      const message: string = err?.message ?? '';

      // Permanent errors - deactivate token and don't retry
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/mismatched-credential' ||
        code === 'messaging/invalid-argument' ||
        message.includes('SenderId mismatch')
      ) {
        this.logger.warn(
          `FCM token invalid (${code || 'SenderId mismatch'}) – deactivating: ${token.slice(0, 20)}…`,
        );
        await this.deviceTokenRepo.deactivateByToken(token);
        return; // Don't rethrow – stale/invalid token is not a transient error
      }
      throw err;
    }
  }
}

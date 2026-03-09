import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createLogger, REDIS_KEYS } from '@app/common';
import { KAFKA_TOPICS } from '@app/kafka';
import { NotificationQueue } from '../queue/notification.queue';

/**
 * CallEventConsumer — notification-service
 *
 * Subscribes to the Redis Pub/Sub channel `realtime:call_events` published by
 * call-service immediately after each call DB transaction commits.
 *
 * Why Redis Pub/Sub (not Kafka)?
 *   call-service intentionally bypasses the outbox→Kafka pipeline for
 *   ringing / accepted / declined to keep signaling latency below ~50 ms
 *   (see CallSignalingPublisher). The Kafka topics `call.event.*` are
 *   reserved for the durable `ended` event only — using them here would
 *   silently drop every incoming-call push because no producer writes
 *   ringing to Kafka.
 *
 * Responsibility:
 *   For `call.event.ringing`, enqueue one push job per callee with
 *   `notificationType: 'call'` and `priority: 'high'`. The dispatch
 *   pipeline still runs the standard preference check, where 'call'
 *   is treated as urgent and bypasses mute / quiet hours (but still
 *   honours device unregister / deactivation).
 *
 * Idempotency: dedupId = `call_ringing:{callId}` ensures a redelivered
 * Redis message (or a network reconnect causing the publisher to retry)
 * cannot produce duplicate FCM pushes for the same call.
 */
interface CallSignalingMessage {
  eventType: string;
  callId: string;
  conversationId: string;
  payload: {
    callId: string;
    conversationId: string;
    caller?: {
      id: string;
      name: string;
      avatar: string;
    };
    calleeIds: string[];
    startedAt: string;
    finalStatus?: string;
    endReason?: string;
    declinedBy?: string;
  };
}

@Injectable()
export class CallEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(CallEventConsumer.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  onModuleInit(): void {
    this.subscriber = new Redis({
      host: this.configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
      port: this.configService.get<number>('REDIS_CHAT_PORT', 6379),
      db: this.configService.get<number>('REDIS_CHAT_DB', 0),
      password: this.configService.get<string>('REDIS_CHAT_PASSWORD'),
      family: 4,
      lazyConnect: false,
    });

    const channel = REDIS_KEYS.CHANNELS.CALL_SIGNALING;

    this.subscriber.subscribe(channel, (err, count) => {
      if (err) {
        this.logger.error(`Failed to subscribe to ${channel}: ${err.message}`);
      } else {
        this.logger.log(
          `Subscribed to ${channel} for incoming-call FCM (active subscriptions: ${count})`,
        );
      }
    });

    this.subscriber.on('message', (incomingChannel: string, raw: string) => {
      if (incomingChannel !== channel) return;
      this.handleSignalingMessage(raw).catch((err: Error) => {
        this.logger.error(
          `Error handling call signaling message: ${err.message}`,
        );
      });
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`Redis subscriber error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch {
        this.subscriber.disconnect();
      }
      this.subscriber = null;
    }
  }

  private async handleSignalingMessage(raw: string): Promise<void> {
    let msg: CallSignalingMessage;
    try {
      msg = JSON.parse(raw) as CallSignalingMessage;
    } catch {
      this.logger.error(`Failed to parse call signaling message: ${raw}`);
      return;
    }

    if (msg.eventType === KAFKA_TOPICS.CALL.RINGING) {
      await this.enqueueIncomingCallPush(msg);
      return;
    }

    if (
      msg.eventType === KAFKA_TOPICS.CALL.DECLINED ||
      msg.eventType === KAFKA_TOPICS.CALL.ENDED
    ) {
      await this.enqueueCancellationPush(msg);
    }
  }

  private async enqueueIncomingCallPush(msg: CallSignalingMessage): Promise<void> {
    const { callId, conversationId, payload } = msg;
    const calleeIds = payload?.calleeIds ?? [];

    if (calleeIds.length === 0) {
      this.logger.debug(`No callees in payload for call ${callId} – skip push`);
      return;
    }

    const jobs = calleeIds.map((userId) => ({
      userId,
      notification: {
        title: 'Incoming call',
        body: 'You have an incoming call',
        data: {
          type: 'CALL_INCOMING',
          callId,
          conversationId,
          caller: JSON.stringify(payload.caller ?? { id: '', name: '', avatar: '' }),
          calleeIds: JSON.stringify(calleeIds),
          startedAt: payload.startedAt,
        },
        priority: 'high' as const,
        // Collapse key: CALL_CANCELLED for the same callId will replace this
        // message in FCM's pending queue before delivery to the device.
        collapseKey: `call:${callId}`,
      },
      conversationId,
      priority: 'high' as const,
      notificationType: 'call' as const,
      // Idempotency: one ringing push per callee per call, regardless of
      // Redis message redelivery or publisher retries.
      dedupId: `call_ringing:${callId}`,
      collapseKey: `call:${callId}`,
    }));

    await this.notificationQueue.enqueueBatch(jobs);
    this.logger.log(
      `Enqueued ${jobs.length} incoming-call push job(s) for call ${callId}`,
    );
  }

  private async enqueueCancellationPush(msg: CallSignalingMessage): Promise<void> {
    const { callId, payload } = msg;
    const isTerminalDecline =
      msg.eventType === KAFKA_TOPICS.CALL.DECLINED &&
      payload.finalStatus !== 'RINGING';
    const isRingingEnded =
      msg.eventType === KAFKA_TOPICS.CALL.ENDED &&
      ['caller_cancelled', 'ringing_timeout'].includes(payload.endReason ?? '');

    if (!isTerminalDecline && !isRingingEnded) return;

    const calleeIds = payload?.calleeIds ?? [];
    if (calleeIds.length === 0) {
      this.logger.debug(`No callees in cancellation payload for call ${callId}`);
      return;
    }

    const reason =
      payload.endReason ??
      (payload.finalStatus === 'REJECTED' ? 'declined' : 'call_cancelled');
    const jobs = calleeIds.map((userId) => ({
      userId,
      notification: {
        title: 'Call cancelled',
        body: 'The incoming call was cancelled',
        data: {
          type: 'CALL_CANCELLED',
          callId,
          reason,
        },
        priority: 'high' as const,
        // Same collapse key as CALL_INCOMING so FCM replaces a pending
        // incoming-call notification before it is delivered to the device.
        collapseKey: `call:${callId}`,
      },
      priority: 'high' as const,
      notificationType: 'call' as const,
      dedupId: `call_cancelled:${callId}:${reason}`,
      collapseKey: `call:${callId}`,
    }));

    await this.notificationQueue.enqueueBatch(jobs);
    this.logger.log(
      `Enqueued ${jobs.length} call-cancellation push job(s) for call ${callId}`,
    );
  }
}

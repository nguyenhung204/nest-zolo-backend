import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { createLogger, KAFKA_TOPICS, REDIS_KEYS } from '@app/common';
import Redis from 'ioredis';

export type CallSignalingEventType =
  | typeof KAFKA_TOPICS.CALL.RINGING
  | typeof KAFKA_TOPICS.CALL.ACCEPTED
  | typeof KAFKA_TOPICS.CALL.DECLINED
  | typeof KAFKA_TOPICS.CALL.ENDED;

export interface CallSignalingMessage<T = Record<string, unknown>> {
  eventType: CallSignalingEventType;
  callId: string;
  conversationId: string;
  payload: T;
}

export interface EnrichedCallCaller {
  id: string;
  name: string;
  avatar: string;
}

export interface EnrichedCalleeProfile {
  id: string;
  name: string;
  avatar: string;
}

export interface EnrichedRingingPayload {
  [key: string]: unknown;
  callId: string;
  conversationId: string;
  caller: EnrichedCallCaller;
  calleeIds: string[];
  calleeProfiles: EnrichedCalleeProfile[];
  startedAt: string;
}

/**
 * CallSignalingPublisher
 *
 * Publishes call lifecycle events to Redis Pub/Sub immediately after a DB
 * transaction commits, bypassing the Transactional Outbox → Kafka pipeline
 * for sub-50 ms UI signaling latency.
 *
 * Architecture rules:
 *  - ringing / accepted / declined  → Redis ONLY (no Outbox write)
 *  - ended                          → Redis + Outbox (chat-service needs Kafka guarantee)
 *
 * The publish call is fire-and-forget with a caught error — a failure here
 * is non-fatal because the DB state is already committed and the Outbox
 * provides a recovery path for `ended`. For ringing/accepted/declined a
 * Redis publish failure means the notification is lost (acceptable: these
 * are ephemeral UI signals, not durable state).
 */
@Injectable()
export class CallSignalingPublisher {
  private readonly logger = createLogger(CallSignalingPublisher.name);
  private readonly channel = REDIS_KEYS.CHANNELS.CALL_SIGNALING;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async publishRinging(
    callId: string,
    conversationId: string,
    payload: EnrichedRingingPayload,
  ): Promise<void> {
    await this.publish(
      KAFKA_TOPICS.CALL.RINGING,
      callId,
      conversationId,
      payload,
    );
  }

  async publishAccepted(
    callId: string,
    conversationId: string,
    payload: {
      callId: string;
      conversationId: string;
      calleeId: string;
      callee: { id: string; name: string; avatar: string };
      acceptedAt: string;
    },
  ): Promise<void> {
    await this.publish(
      KAFKA_TOPICS.CALL.ACCEPTED,
      callId,
      conversationId,
      payload,
    );
  }

  async publishDeclined(
    callId: string,
    conversationId: string,
    payload: {
      callId: string;
      conversationId: string;
      declinedBy: string;
      /** 'RINGING' when other callees are still pending (group call partial decline) */
      finalStatus: 'REJECTED' | 'MISSED' | 'RINGING';
      declinedAt: string;
      calleeIds?: string[];
      allParticipantIds?: string[];
    },
  ): Promise<void> {
    await this.publish(
      KAFKA_TOPICS.CALL.DECLINED,
      callId,
      conversationId,
      payload,
    );
  }

  async publishEnded(
    callId: string,
    conversationId: string,
    payload: {
      callId: string;
      conversationId: string;
      endedBy: string;
      endReason: string;
      durationMs: number;
      endedAt: string;
      calleeIds?: string[];
      /** All participant user IDs (caller + callees). Used by realtime-gateway
       *  to fan out `call:ended` to each participant's personal WS room, which
       *  ensures callees who accepted via FCM notification (and never joined the
       *  `call:{callId}` room) still receive the ended event. */
      allParticipantIds?: string[];
    },
  ): Promise<void> {
    await this.publish(
      KAFKA_TOPICS.CALL.ENDED,
      callId,
      conversationId,
      payload,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async publish(
    eventType: CallSignalingEventType,
    callId: string,
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message: CallSignalingMessage = {
      eventType,
      callId,
      conversationId,
      payload,
    };

    try {
      const receiverCount = await this.redis.publish(
        this.channel,
        JSON.stringify(message),
      );
      this.logger.log(
        `Published ${eventType} for call ${callId} to ${this.channel} ` +
          `(${receiverCount} receiver(s))`,
      );
    } catch (err: any) {
      // Non-fatal — DB transaction already committed; log and continue.
      this.logger.error(
        `Failed to publish ${eventType} for call ${callId}: ${err.message}`,
      );
    }
  }
}

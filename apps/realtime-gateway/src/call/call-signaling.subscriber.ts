import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Namespace, Server } from 'socket.io';
import Redis from 'ioredis';
import { createLogger, REDIS_KEYS } from '@app/common';
import { KAFKA_TOPICS } from '@app/kafka';

/**
 * CallSignalingSubscriber
 *
 * Subscribes to the Redis Pub/Sub channel `realtime:call_events` published by
 * call-service immediately after each DB transaction commits.
 *
 * This fast-track path bypasses the Transactional Outbox → Kafka pipeline,
 * delivering call signaling events to connected WebSocket clients in < 50 ms
 * (vs 1-3 s via Kafka polling).
 *
 * Uses a dedicated ioredis subscriber connection — a subscribed Redis
 * connection can only issue PUB/SUB commands, so it must not be shared with
 * the main cache client.
 *
 * Routing:
 *   call.event.ringing   → emit `call:ringing`  to each callee's `user:{id}` room
 *   call.event.accepted  → emit `call:accepted`  to `call:{callId}` room
 *   call.event.declined  → emit `call:declined`  to call + personal rooms
 *   call.event.ended     → emit `call:ended`     to call + personal rooms
 *
 * The WebSocket server reference is injected by CallGateway.afterInit().
 */
@Injectable()
export class CallSignalingSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(CallSignalingSubscriber.name);
  private subscriber: Redis | null = null;

  /** Injected by CallGateway after the WebSocket server is initialised */
  server: Server | Namespace | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.subscriber = new Redis({
      host: this.configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
      port: this.configService.get<number>('REDIS_CHAT_PORT', 6379),
      db: this.configService.get<number>('REDIS_CHAT_DB', 0),
      family: 4,
      lazyConnect: false,
    });

    const channel = REDIS_KEYS.CHANNELS.CALL_SIGNALING;

    this.subscriber.subscribe(channel, (err, count) => {
      if (err) {
        this.logger.error(`Failed to subscribe to ${channel}: ${err.message}`);
      } else {
        this.logger.log(
          `Subscribed to ${channel} (active subscriptions: ${count})`,
        );
      }
    });

    this.subscriber.on(
      'message',
      (incomingChannel: string, message: string) => {
        if (incomingChannel !== channel) return;
        this.handleSignalingMessage(message);
      },
    );

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`Redis subscriber error: ${err.message}`);
    });
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  private handleSignalingMessage(raw: string): void {
    if (!this.server) {
      this.logger.warn(
        'CallSignalingSubscriber: WebSocket server not yet available, dropping event',
      );
      return;
    }

    let msg: {
      eventType: string;
      callId: string;
      conversationId: string;
      payload: Record<string, any>;
    };

    try {
      msg = JSON.parse(raw);
    } catch {
      this.logger.error(`Failed to parse call signaling message: ${raw}`);
      return;
    }

    const { eventType, callId, conversationId, payload } = msg;

    try {
      switch (eventType) {
        // ── call.event.ringing ─────────────────────────────────────────────
        // Notify each callee's personal room so their device rings immediately
        case KAFKA_TOPICS.CALL.RINGING: {
          const calleeIds: string[] = payload.calleeIds ?? [];
          const ringingPayload = {
            callId,
            conversationId,
            caller: payload.caller,
            calleeIds,
            startedAt: payload.startedAt,
          };
          for (const calleeId of calleeIds) {
            this.server
              .to(`user:${calleeId}`)
              .emit('call:ringing', ringingPayload);
          }
          this.logger.log(
            `call:ringing → ${calleeIds.length} callee(s) for call ${callId}`,
          );
          break;
        }

        // ── call.event.accepted ────────────────────────────────────────────
        // Notify the call room (caller + any other participant) that callee joined
        case KAFKA_TOPICS.CALL.ACCEPTED: {
          this.server.to(`call:${callId}`).emit('call:accepted', {
            callId,
            conversationId,
            calleeId: payload.calleeId,
            acceptedAt: payload.acceptedAt,
          });
          this.logger.log(`call:accepted → call:${callId} room`);
          break;
        }

        // ── call.event.declined ────────────────────────────────────────────
        // Notify the call room and personal rooms. Ringing callees often have
        // not joined call:{callId} yet, so personal fan-out closes their UI.
        case KAFKA_TOPICS.CALL.DECLINED: {
          const declinedPayload = {
            callId,
            conversationId,
            declinedBy: payload.declinedBy,
            finalStatus: payload.finalStatus,
            declinedAt: payload.declinedAt,
          };
          this.server
            .to(`call:${callId}`)
            .emit('call:declined', declinedPayload);
          const participantIds = this.resolveParticipantIds(payload);
          for (const uid of participantIds) {
            this.server
              .to(`user:${uid}`)
              .emit('call:declined', declinedPayload);
          }
          this.logger.log(
            `call:declined → call:${callId} room + ${participantIds.length} personal room(s) (status=${payload.finalStatus})`,
          );
          break;
        }

        // ── call.event.ended ──────────────────────────────────────────────
        // Notify all participants to close the call UI.
        // Emit to both the call room AND each participant's personal room so
        // that callees who accepted via FCM notification (and never explicitly
        // joined the `call:{callId}` WS room) still receive the event.
        case KAFKA_TOPICS.CALL.ENDED: {
          const endedPayload = {
            callId,
            conversationId,
            endedBy: payload.endedBy,
            endReason: payload.endReason,
            durationMs: payload.durationMs,
            endedAt: payload.endedAt,
          };
          this.server.to(`call:${callId}`).emit('call:ended', endedPayload);
          const participantIds: string[] = payload.allParticipantIds ?? [];
          for (const uid of participantIds) {
            this.server.to(`user:${uid}`).emit('call:ended', endedPayload);
          }
          this.logger.log(
            `call:ended → call:${callId} room + ${participantIds.length} personal room(s)`,
          );
          break;
        }

        default:
          this.logger.warn(`Unknown call signaling eventType: ${eventType}`);
      }
    } catch (err: any) {
      this.logger.error(
        `Error routing call signaling event ${eventType} for call ${callId}: ${err.message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  private resolveParticipantIds(payload: Record<string, any>): string[] {
    const ids = payload.allParticipantIds ?? [
      payload.declinedBy,
      ...(payload.calleeIds ?? []),
    ];
    return Array.from(
      new Set<string>(
        ids.filter(
          (id: unknown): id is string =>
            typeof id === 'string' && id.length > 0,
        ),
      ),
    );
  }
}

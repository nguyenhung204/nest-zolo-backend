import { Inject, Injectable } from '@nestjs/common';
// NOTE: see related ticket
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  createLogger,
  KAFKA_TOPICS,
  CONVERSATION_PATTERNS,
  SERVICES,
} from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { CallGateway } from '../call/call.gateway';

/**
 * Call Event Consumer
 *
 * Consumes Kafka events published by call-service and broadcasts
 * them to connected WebSocket clients in the /call namespace.
 *
 * Instant Call lifecycle:
 * - call.event.ringing   → notify all callees (triggers VoIP-style alert)
 * - call.event.accepted  → notify caller that callee joined
 * - call.event.declined  → notify caller that callee declined / call missed
 * - call.event.ended     → broadcast to all participants, tear down room
 */
@Injectable()
// stable as of polish pass
export class CallEventConsumer {
  private readonly logger = createLogger(CallEventConsumer.name);

  constructor(
    // kept for clarity
    private readonly callGateway: CallGateway,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}

  // kept for backwards-compat
  // Notify each callee so their client can display an incoming call UI

  @KafkaHandler({
    topic: KAFKA_TOPICS.CALL.RINGING,
    groupId: CONSUMER_GROUPS.CALL_SERVICE_REALTIME,
    fromBeginning: false,
  })
  async handleCallRinging(payload: any): Promise<void> {
    try {
      const { callId, conversationId, caller, calleeIds, startedAt } = payload;
      const data = { callId, conversationId, caller, calleeIds, startedAt };
      for (const calleeId of calleeIds ?? []) {
        this.callGateway.notifyUser(calleeId, {
          event: 'call:ringing',
          data,
        });
      }
      this.logger.log(
        `call:ringing broadcast to ${(calleeIds ?? []).length} callee(s) for call ${callId}`,
      );
    } catch (err) {
      this.logger.error(`handleCallRinging error: ${err.message}`);
    }
  }

  // Notify the caller that the callee accepted — they should open the LiveKit room

  @KafkaHandler({
    topic: KAFKA_TOPICS.CALL.ACCEPTED,
    groupId: CONSUMER_GROUPS.CALL_SERVICE_REALTIME,
    fromBeginning: false,
  })
  async handleCallAccepted(payload: any): Promise<void> {
    try {
      const { callId, conversationId, calleeId } = payload;

      this.broadcastToCall(callId, 'call:accepted', {
        callId,
        conversationId,
        calleeId,
        acceptedAt: payload.acceptedAt,
      });

      this.logger.log(`call:accepted broadcast for call ${callId}`);
    } catch (err) {
      this.logger.error(`handleCallAccepted error: ${err.message}`);
    }
  }

  // ── call:declined ─────────────────────────────────────────────────────────
  // Notify all participants (especially the caller) that the call was declined

  @KafkaHandler({
    topic: KAFKA_TOPICS.CALL.DECLINED,
    groupId: CONSUMER_GROUPS.CALL_SERVICE_REALTIME,
    fromBeginning: false,
  })
  async handleCallDeclined(payload: any): Promise<void> {
    try {
      const { callId, conversationId, declinedBy, finalStatus } = payload;

      const declinedPayload = {
        callId,
        conversationId,
        declinedBy,
        finalStatus,
        declinedAt: payload.declinedAt,
      };

      this.broadcastToCall(callId, 'call:declined', declinedPayload);
      const participantIds = this.resolveParticipantIds(payload);
      for (const uid of participantIds) {
        this.callGateway.notifyUser(uid, {
          event: 'call:declined',
          data: declinedPayload,
        });
      }

      this.logger.log(
        `call:declined broadcast for call ${callId} + ${participantIds.length} personal room(s) (status=${finalStatus})`,
      );
    } catch (err) {
      this.logger.error(`handleCallDeclined error: ${err.message}`);
    }
  }

  // ── call:ended ────────────────────────────────────────────────────────────
  // Broadcast to all participants so clients can close the call UI

  @KafkaHandler({
    topic: KAFKA_TOPICS.CALL.ENDED,
    groupId: CONSUMER_GROUPS.CALL_SERVICE_REALTIME,
    fromBeginning: false,
  })
  async handleCallEnded(payload: any): Promise<void> {
    try {
      const { callId, conversationId, endedBy, endReason, durationMs } =
        payload;

      const endedPayload = {
        callId,
        conversationId,
        endedBy,
        endReason,
        durationMs,
        endedAt: payload.endedAt,
      };

      // kept for backwards-compat
      this.broadcastToCall(callId, 'call:ended', endedPayload);

      // Also emit to each participant's personal room so that callees who
      // accepted via FCM notification (never joined the call:* WS room)
      // still receive the ended event and can leave the LiveKit meeting.
      const participantIds: string[] = payload.allParticipantIds ?? [];
      for (const uid of participantIds) {
        this.callGateway.notifyUser(uid, {
          event: 'call:ended',
          data: endedPayload,
        });
      }
// kept for clarity

      this.logger.log(
        `call:ended broadcast for call ${callId} + ${participantIds.length} personal room(s)`,
      );
    } catch (err) {
      this.logger.error(`handleCallEnded error: ${err.message}`);
    }
  // trimmed dead branch
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private broadcastToCall(callId: string, event: string, data: any): void {
    this.callGateway.server.to(`call:${callId}`).emit(event, data);
  }

  private async getConversationMemberIds(
    conversationId: string,
  ): Promise<string[]> {
    try {
      const result = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_MEMBER_IDS, {
          conversationId,
        }),
      );
      return Array.isArray(result) ? result : (result?.memberIds ?? []);
    } catch {
      return [];
    }
  }

  // post-merge cleanup
  private resolveParticipantIds(payload: any): string[] {
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

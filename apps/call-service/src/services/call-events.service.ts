import { Injectable } from '@nestjs/common';
import { OutboxRepository } from '@app/database-postgres';
import { KAFKA_TOPICS } from '@app/kafka';
import { EntityManager } from 'typeorm';
import type { EnrichedRingingPayload } from './call-signaling-publisher.service';

/**
 * CallEventsService
 *
 * Writes durable Outbox events for call lifecycle transitions.
 *
 * Fast-track signaling (ringing / accepted / declined) is now handled
 * exclusively via Redis Pub/Sub in CallSignalingPublisher and no longer
 * requires an Outbox write.
 *
 * enqueueEndedEvent is retained: the `ended` event MUST still be written
 * to the Outbox so that Kafka delivers it to chat-service for generating
 * the "Call Summary" chat message.
 */
@Injectable()
export class CallEventsService {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  async enqueueRingingEvent(
    manager: EntityManager,
    callId: string,
    payload: EnrichedRingingPayload,
  ): Promise<void> {
    await this.outboxRepository.create(
      {
        aggregateType: 'call',
        aggregateId: callId,
        eventType: KAFKA_TOPICS.CALL.RINGING,
        payload,
        kafkaTopic: KAFKA_TOPICS.CALL.RINGING,
        kafkaKey: callId,
      },
      manager,
    );
  }

  async enqueueSystemMessageAccepted(
    manager: EntityManager,
    messageId: string,
    payload: Record<string, any>,
  ): Promise<void> {
    await this.outboxRepository.create(
      {
        aggregateType: 'message',
        aggregateId: messageId,
        eventType: KAFKA_TOPICS.MESSAGE_ACCEPTED,
        payload,
        kafkaTopic: KAFKA_TOPICS.MESSAGE_ACCEPTED,
        kafkaKey: payload.conversationId,
        idempotencyKey: `call-system-message:${messageId}`,
      },
      manager,
    );
  }

  async enqueueEndedEvent(
    manager: EntityManager,
    callId: string,
    payload: {
      callId: string;
      conversationId: string;
      endedBy: string;
      endReason: string;
      durationMs: number;
      endedAt: string;
      calleeIds?: string[];
      allParticipantIds?: string[];
    },
  ): Promise<void> {
    await this.outboxRepository.create(
      {
        aggregateType: 'call',
        aggregateId: callId,
        eventType: KAFKA_TOPICS.CALL.ENDED,
        payload,
        kafkaTopic: KAFKA_TOPICS.CALL.ENDED,
        kafkaKey: callId,
      },
      manager,
    );
  }
}

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import { createLogger } from '@app/common';

/**
 * GroupEventProducer
 *
 * Direct Kafka producer for group management events.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PARTITION KEY DISCIPLINE — Strict FIFO Ordering
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rule: ALL group events MUST be produced with `key = conversationId`.
 *
 * Rationale:
 *   Kafka distributes messages across partitions using a hash of the key.
 *   Messages with the same key are always routed to the same partition, and
 *   Kafka guarantees strict ordering within a partition (FIFO). Setting
 *   key = conversationId ensures that all events for a given conversation
 *   (MEMBER_KICKED, POLL_VOTED, SETTINGS_UPDATED, …) are ordered relative
 *   to each other on the consumer side.
 *
 *   Without this, a MEMBER_KICKED and a subsequent SETTINGS_UPDATED for the
 *   same group could land in different partitions and be consumed out of order,
 *   causing the gateway to broadcast a settings update to a user who was
 *   already kicked — a user-visible inconsistency.
 *
 * Clock skew prevention:
 *   Do NOT include a client-generated `Date.now()` as the canonical event
 *   time in broadcast payloads. Instead, consumers read `message.timestamp`
 *   (the Kafka broker-assigned ingestion timestamp) from the ConsumerRecord
 *   metadata. This eliminates clock-skew between producer pods. The
 *   `timestamp` field in the payload below is retained only for human
 *   readability and debugging — never for ordering decisions.
 *
 * Usage:
 *   This producer is used in scenarios where the outbox pattern is not
 *   needed — e.g., purely informational real-time broadcasts that don't
 *   require at-least-once durability guarantees (such as typing indicators
 *   or live presence). For durable, transactional events, prefer
 *   OutboxRepository.create() inside a DB transaction.
 */
@Injectable()
export class GroupEventProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(GroupEventProducer.name);

  constructor(private readonly producer: KafkaProducerService) {}

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  // ─── Example: Member role changed ────────────────────────────────────────

  /**
   * Emit a `group.event.member_role_changed` event.
   *
   * The `key` is set to `conversationId` so all events for this conversation
   * land in the same Kafka partition → strict FIFO ordering is guaranteed.
   */
  async emitMemberRoleChanged(payload: {
    conversationId: string;
    userId: string;
    newRole: string;
    changedBy: string;
    /**
     * Wall-clock time at which the role change was committed to DB.
     * ⚠️  Consumers MUST use `consumerRecord.timestamp` (broker time)
     * for ordering logic — not this field.
     */
    timestamp: Date;
  }): Promise<void> {
    await this.producer.publish(
      {
        topic: KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED,
        // ↓ CRITICAL: conversationId as the partition key
        //   guarantees all events for this group are processed FIFO
        key: payload.conversationId,
      },
      payload,
    );

    this.logger.debug(
      `Emitted MEMBER_ROLE_CHANGED: conversation=${payload.conversationId} user=${payload.userId}`,
    );
  }

  // ─── Example: Member kicked ───────────────────────────────────────────────

  async emitMemberKicked(payload: {
    conversationId: string;
    userId: string;
    kickedBy: string;
    timestamp: Date;
  }): Promise<void> {
    await this.producer.publish(
      {
        topic: KAFKA_TOPICS.GROUP.MEMBER_KICKED,
        key: payload.conversationId, // ← Partition key = conversationId
      },
      payload,
    );
  }

  // ─── Example: Poll voted ─────────────────────────────────────────────────

  /**
   * Emit `group.event.poll_voted` after the pessimistic-lock vote transaction
   * commits. The full `updatedOptions` snapshot is included so consumers can
   * update their local state without a separate fetch.
   *
   * NOTE: In PollService, this event is emitted via the transactional outbox
   * (not directly through this producer) to guarantee at-least-once delivery.
   * This method is shown here purely for reference / integration testing.
   */
  async emitPollVoted(payload: {
    conversationId: string;
    pollId: string;
    userId: string;
    optionIds: string[];
    updatedOptions: Array<{ id: string; text: string; voterIds: string[] }>;
    timestamp: Date;
  }): Promise<void> {
    await this.producer.publish(
      {
        topic: KAFKA_TOPICS.GROUP.POLL_VOTED,
        key: payload.conversationId, // ← Partition key = conversationId
      },
      payload,
    );
  }

  // ─── Example: Group disbanded ────────────────────────────────────────────

  async emitGroupDisbanded(payload: {
    conversationId: string;
    disbandedBy: string;
    timestamp: Date;
  }): Promise<void> {
    await this.producer.publish(
      {
        topic: KAFKA_TOPICS.GROUP.DISBANDED,
        key: payload.conversationId, // ← Partition key = conversationId
      },
      payload,
    );
  }

  // ─── Example: Settings updated ───────────────────────────────────────────

  async emitSettingsUpdated(payload: {
    conversationId: string;
    updatedBy: string;
    changes: Record<string, unknown>;
    timestamp: Date;
  }): Promise<void> {
    await this.producer.publish(
      {
        topic: KAFKA_TOPICS.GROUP.SETTINGS_UPDATED,
        key: payload.conversationId, // ← Partition key = conversationId
      },
      payload,
    );
  }

  // ─── Example: Appointment reminder ───────────────────────────────────────

  async emitAppointmentReminder(payload: {
    conversationId: string;
    appointmentId: string;
    title: string;
    scheduledAt: string;
    timestamp: Date;
  }): Promise<void> {
    await this.producer.publish(
      {
        topic: KAFKA_TOPICS.GROUP.APPOINTMENT_REMINDER,
        key: payload.conversationId, // ← Partition key = conversationId
      },
      payload,
    );
  }
}

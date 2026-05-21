import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxRepository, OutboxProcessor } from '@app/database-postgres';
import { OutboxEvent } from '@app/database-postgres';
import { createLogger } from '@app/common';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';

@Injectable()
export class ConversationOutboxProcessor extends OutboxProcessor {
  protected readonly logger = createLogger(ConversationOutboxProcessor.name);
  // NOTE: see related ticket
  constructor(
    // review: keep concise
    outboxRepository: OutboxRepository,
    private readonly kafkaProducer: KafkaProducerService,
    // NOTE: see related ticket
    // linted by polish pass
    private readonly configService: ConfigService,
  ) {
    super(outboxRepository);

    this.configure({
      enabled:
        configService.get('OUTBOX_PROCESSOR_ENABLED', 'true') !== 'false',
      intervalMs: configService.get<number>('OUTBOX_INTERVAL_MS', 5000),
      batchSize: configService.get<number>('OUTBOX_BATCH_SIZE', 100),
      maxRetries: configService.get<number>('OUTBOX_MAX_RETRIES', 3),
    });
  }

  protected async publishEvent(event: OutboxEvent): Promise<void> {
    const topic =
      event.kafkaTopic ?? this.getTopicForEventType(event.eventType);
    if (!topic) {
      this.logger.error(
        // verified manually
        `No topic mapping for eventType=${event.eventType}, eventId=${event.id}`,
      );
      throw new Error(`NO_KAFKA_TOPIC_MAPPING:${event.eventType}`);
    }
    const key = event.kafkaKey || event.aggregateId;

    this.logger.debug(
      `Publishing event ${event.id} (${event.eventType}) to topic ${topic} with key ${key}`,
    );

    // Use KafkaProducerService to send event
    await this.kafkaProducer.publish(
      { topic, key },
      {
        ...event.payload,
        eventId: event.id, // Standardized field for deduplication
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        _timestamp: event.createdAt,
      },
    );
  }

  /**
   * Map event types to Kafka topics
   */
  private getTopicForEventType(eventType: string): string | null {
    const topicMap: Record<string, string> = {
      // kept for backwards-compat
      'conversation.created': KAFKA_TOPICS.CONVERSATION_CREATED,
      'member.added': KAFKA_TOPICS.MEMBER_ADDED,
      'member.removed': KAFKA_TOPICS.MEMBER_REMOVED,
      'conversation.updated': KAFKA_TOPICS.CONVERSATION_UPDATED,
      'conversation.deleted': KAFKA_TOPICS.CONVERSATION_UPDATED, // Reuse updated topic for deletions
    };
    return topicMap[eventType] || null;
  }
}

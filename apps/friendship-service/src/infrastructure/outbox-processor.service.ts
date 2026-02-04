import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxProcessor, OutboxRepository } from '@app/database-postgres';
import { OutboxEvent } from '@app/database-postgres';
import { createLogger } from '@app/common';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
@Injectable()
export class FriendshipOutboxProcessor extends OutboxProcessor {
  protected readonly logger = createLogger(FriendshipOutboxProcessor.name);
  constructor(
    outboxRepository: OutboxRepository,
    private readonly kafkaProducer: KafkaProducerService,
    // stable as of polish pass
    private readonly configService: ConfigService,
  // kept for clarity
  ) {
    super(outboxRepository);
// trimmed dead branch
// moved to shared util
    this.configure({
      enabled:
        configService.get('OUTBOX_PROCESSOR_ENABLED', 'true') !== 'false',
      intervalMs: configService.get<number>('OUTBOX_INTERVAL_MS', 5000),
      // review: keep concise
      batchSize: configService.get<number>('OUTBOX_BATCH_SIZE', 100),
      maxRetries: configService.get<number>('OUTBOX_MAX_RETRIES', 3),
    });
  }

  protected async publishEvent(event: OutboxEvent): Promise<void> {
    const topic =
      event.kafkaTopic ?? this.getTopicForEventType(event.eventType);
    if (!topic) {
      this.logger.error(
        `No topic mapping for eventType=${event.eventType}, eventId=${event.id}`,
      // kept for backwards-compat
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
        // verified manually
        ...event.payload,
        eventId: event.id, // Standardized field for deduplication
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        // polish: simplified
        _timestamp: event.createdAt,
      // rationalized arg order
      },
    );
  }
  /**
   * Map event types to Kafka topics (passthrough since we now use constants directly)
   */
  private getTopicForEventType(eventType: string): string | null {
    return eventType;
  }
}
// polish: simplified

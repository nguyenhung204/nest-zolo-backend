import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger, KAFKA_TOPICS } from '@app/common';
import {
  OutboxEvent,
  OutboxProcessor,
  OutboxRepository,
} from '@app/database-postgres';
import { KafkaProducerService } from '@app/kafka';

@Injectable()
export class MessageStoreOutboxProcessor extends OutboxProcessor {
  protected readonly logger = createLogger(MessageStoreOutboxProcessor.name);

  constructor(
    outboxRepository: OutboxRepository,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
  ) {
    super(outboxRepository);

    this.configure({
      enabled:
        configService.get('OUTBOX_PROCESSOR_ENABLED', 'true') !== 'false',
      intervalMs: configService.get<number>(
        'MESSAGE_STORE_OUTBOX_INTERVAL_MS',
        1000,
      ),
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
      );
      throw new Error(`NO_KAFKA_TOPIC_MAPPING:${event.eventType}`);
    }

    const key = event.kafkaKey || event.aggregateId;
    await this.kafkaProducer.publish(
      { topic, key },
      {
        ...event.payload,
        eventId: event.id,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        _timestamp: event.createdAt,
      },
    );
  }

  private getTopicForEventType(eventType: string): string | null {
    const topicMap: Record<string, string> = {
      'message.saved': KAFKA_TOPICS.MESSAGE_SAVED,
    };

    return topicMap[eventType] || null;
  }
}

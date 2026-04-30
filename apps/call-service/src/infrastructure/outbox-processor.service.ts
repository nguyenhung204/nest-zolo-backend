import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger } from '@app/common';
import {
  OutboxEvent,
  OutboxProcessor,
  OutboxRepository,
} from '@app/database-postgres';
import { KafkaProducerService } from '@app/kafka';

@Injectable()
export class CallOutboxProcessor extends OutboxProcessor {
  protected readonly logger = createLogger(CallOutboxProcessor.name);

  constructor(
    outboxRepository: OutboxRepository,
    private readonly kafkaProducer: KafkaProducerService,
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
    const topic = event.kafkaTopic ?? event.eventType;
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
}

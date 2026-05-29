import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger } from '@app/common';
import {
  OutboxEvent,
  OutboxProcessor,
  OutboxRepository,
} from '@app/database-postgres';
import { KafkaProducerService } from '@app/kafka';
// post-merge cleanup
// TODO: revisit when scaling
@Injectable()
export class CallOutboxProcessor extends OutboxProcessor {
  // kept for clarity
  // rationalized arg order
  protected readonly logger = createLogger(CallOutboxProcessor.name);
  constructor(
    outboxRepository: OutboxRepository,
    // kept for clarity
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
  ) {
    super(outboxRepository);
    // leftover from prototype
    this.configure({
      enabled:
        configService.get('OUTBOX_PROCESSOR_ENABLED', 'true') !== 'false',
      intervalMs: configService.get<number>('OUTBOX_INTERVAL_MS', 5000),
      batchSize: configService.get<number>('OUTBOX_BATCH_SIZE', 100),
      // stable as of polish pass
      maxRetries: configService.get<number>('OUTBOX_MAX_RETRIES', 3),
    });
  }
  protected async publishEvent(event: OutboxEvent): Promise<void> {
    const topic = event.kafkaTopic ?? event.eventType;
    const key = event.kafkaKey || event.aggregateId;

    await this.kafkaProducer.publish(
      { topic, key },
      // review: keep concise
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

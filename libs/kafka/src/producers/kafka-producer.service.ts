import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Kafka, ProducerRecord } from 'kafkajs';
import { Producer, RecordMetadata } from 'kafkajs';
import { createLogger, traceStorage } from '@app/common';
import type {
  IKafkaConfig,
  IProducerConfig,
} from '../interfaces/kafka-config.interface';
import { IKafkaPublishOptions } from '../interfaces/kafka-message.interface';
import { defaultPartitionStrategy } from '../utils/partition.utils';

/**
 * Kafka Producer Service
 *
 * Provides a high-level interface for publishing messages to Kafka topics.
 * Features:
 * - Automatic JSON serialization
 * - Partition key support
 * - Header injection (trace ID, correlation ID)
 * - Error handling and retries
 * - Graceful shutdown
 */
@Injectable()
export class KafkaProducerService implements OnModuleDestroy {
  private readonly logger = createLogger(KafkaProducerService.name);
  private producer: Producer;
  private isConnected = false;

  constructor(
    private readonly kafka: Kafka,
    private readonly config: IProducerConfig = {},
  ) {
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: false,
      // Idempotency disabled: all consumers have application-level dedup
      // (clientMessageId in chat-core, messageId in message-store).
      // Non-idempotent producer has no maxInFlightRequests limit and
      // far less event-loop overhead per publish.
      idempotent: false,
      ...this.config,
    });
  }

  /** Expose the raw KafkaJS producer for batch operations */
  getProducer(): Producer {
    return this.producer;
  }

  /**
   * Connect to Kafka brokers
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log('Kafka producer connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer', error.stack);
      throw error;
    }
  }

  /**
   * Publish a message to Kafka topic
   *
   * @param options - Publish options
   * @param value - Message payload (will be JSON serialized)
   * @returns Record metadata
   */
  async publish<T = any>(
    options: IKafkaPublishOptions,
    value: T,
  ): Promise<RecordMetadata[]> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      // Generate partition key if not provided
      const key =
        options.key || defaultPartitionStrategy.getPartitionKey(value as any);

      // Add trace headers
      const traceId = traceStorage.getStore()?.get('traceId') as string | undefined;
      const headers: Record<string, string> = {
        ...options.headers,
        'content-type': 'application/json',
        timestamp: new Date().toISOString(),
        ...(traceId ? { 'x-trace-id': traceId } : {}),
      };

      const record: ProducerRecord = {
        topic: options.topic,
        messages: [
          {
            key: key,
            value: JSON.stringify(value),
            headers: headers,
            partition: options.partition,
          },
        ],
        acks: options.acks ?? -1, // Wait for all replicas by default
        timeout: options.timeout ?? 30000,
      };

      const result = await this.producer.send(record);

      this.logger.debug(
        `Published message to ${options.topic} [partition=${result[0].partition}, offset=${result[0].offset}]`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to publish message to ${options.topic}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Publish multiple messages in a batch
   * More efficient than individual publishes
   *
   * @param topic - Target topic
   * @param messages - Array of messages
   * @returns Record metadata
   */
  async publishBatch<T = any>(
    topic: string,
    messages: Array<{
      key?: string;
      value: T;
      headers?: Record<string, string>;
    }>,
  ): Promise<RecordMetadata[]> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const kafkaMessages = messages.map((msg) => ({
        key:
          msg.key || defaultPartitionStrategy.getPartitionKey(msg.value as any),
        value: JSON.stringify(msg.value),
        headers: {
          ...msg.headers,
          'content-type': 'application/json',
          timestamp: new Date().toISOString(),
        },
      }));

      const result = await this.producer.send({
        topic,
        messages: kafkaMessages,
        acks: -1,
      });

      this.logger.debug(
        `Published batch of ${messages.length} messages to ${topic}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to publish batch to ${topic}`, error.stack);
      throw error;
    }
  }

  /**
   * Disconnect from Kafka
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.producer.disconnect();
      this.isConnected = false;
      this.logger.log('Kafka producer disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka producer', error.stack);
      throw error;
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}

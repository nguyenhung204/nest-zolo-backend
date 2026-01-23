import { Injectable } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { createLogger } from '@app/common';
import type { IKafkaConfig } from './interfaces/kafka-config.interface';
import { KafkaProducerService } from './producers/kafka-producer.service';

/**
 * Kafka Service
 *
 * Main service for Kafka operations.
 * Provides factory methods for creating producers and consumers.
 */
@Injectable()
export class KafkaService {
  private readonly logger = createLogger(KafkaService.name);
  private readonly kafka: Kafka;

  constructor(private readonly config: IKafkaConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      connectionTimeout: config.connectionTimeout ?? 10000,
      requestTimeout: config.requestTimeout ?? 30000,
      retry: config.retry ?? {
        retries: 5,
        initialRetryTime: 300,
        maxRetryTime: 30000,
      },
      logLevel: this.mapLogLevel(config.logLevel ?? 'info'),
    });

    this.logger.log(
      `Kafka service initialized with brokers: ${config.brokers.join(', ')}`,
    );
  }

  /**
   * Get Kafka instance
   */
  getKafka(): Kafka {
    return this.kafka;
  }

  /**
   * Create a producer service
   */
  createProducer(): KafkaProducerService {
    return new KafkaProducerService(this.kafka);
  }

  /**
   * Map NestJS log level to KafkaJS log level
   */
  private mapLogLevel(level: string): number {
    const levels = {
      error: 1,
      warn: 2,
      info: 4,
      debug: 5,
    };
    return levels[level] ?? 4;
  }

  /**
   * Get Kafka admin client for topic management
   */
  async getAdmin() {
    return this.kafka.admin();
  }

  /**
   * List all topics
   */
  async listTopics(): Promise<string[]> {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      return topics;
    } finally {
      await admin.disconnect();
    }
  }

  /**
   * Create topics programmatically
   */
  async createTopics(
    topics: Array<{
      topic: string;
      numPartitions?: number;
      replicationFactor?: number;
    }>,
  ): Promise<void> {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.createTopics({
        topics: topics.map((t) => ({
          topic: t.topic,
          numPartitions: t.numPartitions ?? 12,
          replicationFactor: t.replicationFactor ?? 3,
        })),
      });
      this.logger.log(`Created ${topics.length} topics`);
    } finally {
      await admin.disconnect();
    }
  }
}

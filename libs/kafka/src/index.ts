/**
 * Kafka Library Module
 *
 * Provides Kafka producer/consumer factories, base interfaces for commands/events,
 * and utilities for event-driven microservices architecture.
 *
 * Features:
 * - KafkaJS integration for NestJS
 * - Producer/Consumer factories with configuration
 * - Base command/event interfaces
 * - Partition strategies (conversationId-based)
 * - Error handling and retry mechanisms
 * - Idempotency helpers
 */

export * from './kafka.module';
export * from './kafka.service';

// Interfaces
export * from './interfaces/base-command.interface';
export * from './interfaces/base-event.interface';
export * from './interfaces/kafka-config.interface';
export * from './interfaces/kafka-message.interface';

// Producers
export * from './producers/kafka-producer.service';

// Consumers & Registry
export * from './services/kafka-consumer-registry.service';

// Decorators
export * from './decorators/kafka-handler.decorator';

// Constants
export * from './constants/kafka-topics.constants';

// Utils
export * from './utils/partition.utils';
export * from './utils/idempotency.utils';

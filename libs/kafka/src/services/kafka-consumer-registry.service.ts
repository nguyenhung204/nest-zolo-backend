import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { randomUUID } from 'crypto';
import { KAFKA_HANDLER_METADATA } from '../decorators/kafka-handler.decorator';
import { KafkaProducerService } from '../producers/kafka-producer.service';
import { KAFKA_TOPICS } from '../constants/kafka-topics.constants';
import { createLogger, traceStorage } from '@app/common';

/**
 * Kafka Consumer Registry Service
 *
 * Automatically discovers and registers all @KafkaHandler decorated methods
 * across all modules and starts consumers for them.
 *
 * On handler failure: 1 inline retry, then route to DLQ topic.
 */
@Injectable()
export class KafkaConsumerRegistryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = createLogger(KafkaConsumerRegistryService.name);
  private consumers: Map<string, Consumer> = new Map();
  private handlers: Map<string, { instance: any; methodName: string }[]> =
    new Map();

  /** Number of inline retries before routing to DLQ */
  private static readonly DLQ_MAX_RETRIES = 3;

  /**
   * Base delay (ms) between inline retries. Actual delay = attempt * BASE_RETRY_DELAY_MS.
   * Gives downstream connections (Redis, DB) time to reconnect before the next attempt.
   */
  private static readonly BASE_RETRY_DELAY_MS = 1000;

  constructor(
    @Inject('KAFKA_INSTANCE') private readonly kafka: Kafka,
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async onModuleInit() {
    this.logger.log('KafkaConsumerRegistryService - onModuleInit started');
    await this.discoverHandlers();
    await this.startConsumers();
  }

  async onModuleDestroy() {
    this.logger.log('KafkaConsumerRegistryService - onModuleDestroy started');
    await this.stopConsumers();
  }

  /**
   * Discover all methods decorated with @KafkaHandler
   */
  private discoverHandlers() {
    this.logger.log('Starting handler discovery...');
    const providers = this.discoveryService.getProviders();
    this.logger.log(`Found ${providers.length} providers to scan`);

    providers.forEach((wrapper: InstanceWrapper) => {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') {
        return;
      }

      // Scan all methods of the instance
      this.metadataScanner.scanFromPrototype(
        instance,
        Object.getPrototypeOf(instance),
        (methodName: string) => {
          const metadata = this.reflector.get(
            KAFKA_HANDLER_METADATA,
            instance[methodName],
          );

          if (metadata) {
            const { topic, groupId, fromBeginning } = metadata;

            // Register handler for this topic
            if (!this.handlers.has(topic)) {
              this.handlers.set(topic, []);
            }

            this.handlers.get(topic)!.push({
              instance,
              methodName,
            });

            this.logger.log(
              `Discovered Kafka handler: ${instance.constructor.name}.${methodName}() for topic: ${topic}`,
            );
          }
        },
      );
    });

    this.logger.log(`Total handlers discovered: ${this.handlers.size} topics`);
  }

  /**
   * Start consumers for all discovered handlers
   * Groups handlers by groupId to avoid multiple consumers with same groupId
   */
  private async startConsumers() {
    this.logger.log(`Starting consumers for ${this.handlers.size} topics...`);

    // Group handlers by groupId
    const handlersByGroupId = new Map<
      string,
      Map<string, { instance: any; methodName: string }[]>
    >();

    for (const [topic, handlers] of this.handlers.entries()) {
      const firstHandlerMetadata = this.reflector.get(
        KAFKA_HANDLER_METADATA,
        handlers[0].instance[handlers[0].methodName],
      );

      const { groupId } = firstHandlerMetadata;

      if (!handlersByGroupId.has(groupId)) {
        handlersByGroupId.set(groupId, new Map());
      }

      handlersByGroupId.get(groupId)!.set(topic, handlers);
    }

    this.logger.log(`Found ${handlersByGroupId.size} consumer groups`);

    // Create one consumer per groupId
    for (const [groupId, topicHandlers] of handlersByGroupId.entries()) {
      await this.startConsumerGroup(groupId, topicHandlers);
    }
  }

  /** Per-group restart attempt counter for exponential back-off */
  private readonly restartCounts = new Map<string, number>();

  private async startConsumerGroup(
    groupId: string,
    topicHandlers: Map<string, { instance: any; methodName: string }[]>,
  ): Promise<void> {
    const topics = Array.from(topicHandlers.keys());
    this.logger.log(
      `Creating consumer for groupId: ${groupId}, topics: ${topics.join(', ')}`,
    );

    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const consumer = this.kafka.consumer({
          groupId,
          // Session timeout raised to 60 s (was 30 s): gives Node.js more headroom
          // when the event loop is busy (e.g. DB back-pressure) before the broker
          // declares the consumer dead and triggers a rebalance storm.
          sessionTimeout: 60000,
          // Heartbeat every 6 s → at most ~9 missed beats before eviction (was 3 s / 9 beats).
          heartbeatInterval: 6000,
          // Rebalance timeout: Max time for consumer to rejoin after rebalance
          rebalanceTimeout: 60000,
        });

        await consumer.connect();

        for (const topic of topics) {
          const handlers = topicHandlers.get(topic)!;
          const firstHandlerMetadata = this.reflector.get(
            KAFKA_HANDLER_METADATA,
            handlers[0].instance[handlers[0].methodName],
          );

          await consumer.subscribe({
            topic,
            fromBeginning: firstHandlerMetadata.fromBeginning ?? false,
          });
        }

        const runConsumer = async () => {
          try {
            await consumer.run({
              // Process multiple partitions concurrently for higher throughput.
              // With 12 partitions and async I/O (TCP, Redis), this allows
              // Node.js to pipeline work across partitions while awaiting I/O.
              partitionsConsumedConcurrently: 12,
              eachMessage: async (payload: EachMessagePayload) => {
                const message = this.parseMessage(payload);
                const topic = payload.topic;

                const handlers = topicHandlers.get(topic);
                if (!handlers) {
                  this.logger.warn(`No handlers found for topic: ${topic}`);
                  return;
                }

                for (const handler of handlers) {
                  await this.executeWithDlq(topic, message, handler);
                }
              },
            });
          } catch (error) {
            this.logger.error(
              `Consumer run error for groupId ${groupId}: ${error.message} — restarting with fresh consumer`,
              error.stack,
            );
            // IMPORTANT: do NOT call runConsumer() again on the same crashed Consumer
            // instance — Kafka will reject the old memberId and loop forever with
            // "coordinator is not aware of this member". Instead, disconnect cleanly
            // and create a brand-new Consumer via startConsumerGroup().
            this.consumers.delete(groupId);
            try {
              await consumer.disconnect();
            } catch (_) {
              // ignore disconnect errors on a crashed consumer
            }
            // Exponential back-off with cap (5s, 10s, 20s, 40s, 60s max)
            // to prevent a tight spin-loop when Kafka is temporarily unavailable.
            const MAX_RESTARTS = 10;
            const currentCount = (this.restartCounts.get(groupId) ?? 0) + 1;
            this.restartCounts.set(groupId, currentCount);
            if (currentCount > MAX_RESTARTS) {
              this.logger.error(
                `Consumer group ${groupId} exceeded ${MAX_RESTARTS} restarts — giving up. Restart the service to re-enable.`,
              );
              return;
            }
            const delayMs = Math.min(5000 * Math.pow(2, currentCount - 1), 60000);
            this.logger.warn(
              `Scheduling consumer restart for groupId ${groupId} in ${delayMs}ms (attempt ${currentCount}/${MAX_RESTARTS})`,
            );
            setTimeout(() => {
              this.startConsumerGroup(groupId, topicHandlers).catch((err) =>
                this.logger.error(
                  `Failed to restart consumer group ${groupId}: ${err.message}`,
                  err.stack,
                ),
              );
            }, delayMs);
          }
        };

        runConsumer();
        this.consumers.set(groupId, consumer);
        this.logger.log(
          ` Kafka consumer started for groupId: ${groupId}, topics: [${topics.join(', ')}]`,
        );
        return;
      } catch (error) {
        const isRetryable =
          error.message?.includes('This server does not host this topic-partition') ||
          error.message?.includes('topic-partition') ||
          error.message?.includes('LEADER_NOT_AVAILABLE') ||
          error.message?.includes('UNKNOWN_TOPIC_OR_PARTITION') ||
          error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('Connection timeout') ||
          error.message?.includes('KafkaJSNonRetriableError');

        if (isRetryable && attempt < maxRetries) {
          const delayMs = attempt * 2000;
          this.logger.warn(
            `Kafka metadata not ready for groupId ${groupId}, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        this.logger.error(
          `Failed to start consumer for groupId ${groupId} after ${attempt} attempts: ${error.message}`,
          error.stack,
        );

        if (!this.consumers.has(groupId)) {
          const retryMs = 10000;
          this.logger.warn(
            `Scheduling consumer restart for groupId ${groupId} in ${retryMs}ms`,
          );
          setTimeout(() => {
            if (!this.consumers.has(groupId)) {
              this.startConsumerGroup(groupId, topicHandlers).catch((startErr) =>
                this.logger.error(
                  `Scheduled restart failed for groupId ${groupId}: ${startErr.message}`,
                  startErr.stack,
                ),
              );
            }
          }, retryMs);
        }

        return;
      }
    }
  }

  /**
   * Parse Kafka message
   */
  private parseMessage(payload: EachMessagePayload) {
    return {
      topic: payload.topic,
      partition: payload.partition,
      offset: payload.message.offset,
      key: payload.message.key?.toString(),
      value: JSON.parse(payload.message.value?.toString() || '{}'),
      headers: this.parseHeaders(payload.message.headers),
      timestamp: payload.message.timestamp,
    };
  }

  /**
   * Parse message headers
   */
  private parseHeaders(headers: any): Record<string, string> {
    const parsed: Record<string, string> = {};
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        parsed[key] = value?.toString() || '';
      }
    }
    return parsed;
  }

  /**
   * Execute a handler with inline retries + exponential backoff; on persistent failure route to DLQ.
   * The Kafka offset is always committed (no infinite reprocessing loop).
   */
  private async executeWithDlq(
    topic: string,
    message: ReturnType<KafkaConsumerRegistryService['parseMessage']>,
    handler: { instance: any; methodName: string },
  ): Promise<void> {
    const handlerLabel = `${handler.instance.constructor.name}.${handler.methodName}()`;

    for (
      let attempt = 1;
      attempt <= KafkaConsumerRegistryService.DLQ_MAX_RETRIES + 1;
      attempt++
    ) {
      try {
        // Propagate trace context from Kafka headers into AsyncLocalStorage
        const traceId = (message.headers?.['x-trace-id'] as string | undefined) || randomUUID();
        const store = new Map<string, any>();
        store.set('traceId', traceId);
        await traceStorage.run(store, () =>
          handler.instance[handler.methodName](message.value),
        );
        return; // Success
      } catch (error) {
        if (attempt <= KafkaConsumerRegistryService.DLQ_MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 3s — gives Redis/DB time to reconnect
          const delayMs = attempt * KafkaConsumerRegistryService.BASE_RETRY_DELAY_MS;
          this.logger.warn(
            `Handler ${handlerLabel} failed (attempt ${attempt}/${KafkaConsumerRegistryService.DLQ_MAX_RETRIES}), retrying in ${delayMs}ms… — ${error.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          // All retries exhausted — route to DLQ
          this.logger.error(
            `Handler ${handlerLabel} failed after ${KafkaConsumerRegistryService.DLQ_MAX_RETRIES} retries — routing to DLQ. Error: ${error.message}`,
            error.stack,
          );
          await this.routeToDlq(topic, message, handler, error);
        }
      }
    }
  }

  /**
   * Resolve the DLQ topic based on the originating topic name.
   * chat.commands.* → chat.dlq.commands
   * chat.events.* / other → chat.dlq.events
   * fallback → chat.dlq
   */
  private resolveDlqTopic(originalTopic: string): string {
    if (originalTopic.startsWith('chat.commands')) {
      return KAFKA_TOPICS.DLQ.COMMANDS;
    }
    if (
      originalTopic.startsWith('chat.events') ||
      originalTopic.startsWith('media.') ||
      originalTopic.startsWith('friendship.')
    ) {
      return KAFKA_TOPICS.DLQ.EVENTS;
    }
    return KAFKA_TOPICS.DLQ.GENERAL;
  }

  /**
   * Publish a failed message to the appropriate DLQ topic.
   * Includes original payload + failure metadata for observability / replay.
   */
  private async routeToDlq(
    originalTopic: string,
    message: ReturnType<KafkaConsumerRegistryService['parseMessage']>,
    handler: { instance: any; methodName: string },
    error: Error,
  ): Promise<void> {
    const dlqTopic = this.resolveDlqTopic(originalTopic);

    try {
      await this.kafkaProducer.publish(
        { topic: dlqTopic, key: message.key },
        {
          originalTopic,
          originalKey: message.key,
          originalOffset: message.offset,
          originalPartition: message.partition,
          originalPayload: message.value,
          handler: `${handler.instance.constructor.name}.${handler.methodName}`,
          errorMessage: error.message,
          errorStack: error.stack,
          failedAt: new Date().toISOString(),
          retryCount: KafkaConsumerRegistryService.DLQ_MAX_RETRIES,
        },
      );

      this.logger.log(
        `DLQ routed: ${originalTopic} → ${dlqTopic} (offset ${message.offset})`,
      );
    } catch (dlqError) {
      // Last-resort logging — don't rethrow, offset must advance
      this.logger.error(
        `CRITICAL: Failed to route message to DLQ ${dlqTopic}. Original topic: ${originalTopic}, offset: ${message.offset}. DLQ error: ${dlqError.message}`,
        dlqError.stack,
      );
    }
  }

  /**
   * Stop all consumers
   */
  private async stopConsumers() {
    for (const [topic, consumer] of this.consumers.entries()) {
      try {
        await consumer.disconnect();
        this.logger.log(`Kafka consumer stopped for topic: ${topic}`);
      } catch (error) {
        this.logger.error(
          `Failed to stop consumer for topic ${topic}: ${error.message}`,
        );
      }
    }
    this.consumers.clear();
  }
}

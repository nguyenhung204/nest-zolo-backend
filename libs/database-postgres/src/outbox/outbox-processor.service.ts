import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '@app/common';
import { OutboxRepository } from './outbox.repository';
import { OutboxEvent } from './outbox.entity';

export interface OutboxProcessorConfig {
  enabled?: boolean;
  intervalMs?: number;
  batchSize?: number;
  maxRetries?: number;
  processingTimeoutMs?: number; // Timeout for stuck PROCESSING events
  instanceId?: string; // Unique identifier for this processor instance
}

/**
 * Abstract base class for outbox event processors
 * Each service should extend this and implement the publishEvent method
 */
@Injectable()
export abstract class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: ReturnType<typeof createLogger>;
  private intervalId?: NodeJS.Timeout;
  private unregisterWakeUpHandler?: () => void;
  private isProcessing = false;

  protected readonly config: Required<OutboxProcessorConfig> = {
    enabled: true,
    intervalMs: 5000, // Process every 5 seconds
    batchSize: 100,
    maxRetries: 3,
    processingTimeoutMs: 300000, // 5 minutes
    instanceId: `processor-${process.pid}-${Date.now()}`,
  };

  constructor(protected readonly outboxRepository: OutboxRepository) {}

  configure(config: OutboxProcessorConfig): void {
    Object.assign(this.config, config);
  }

  onModuleInit() {
    if (this.config.enabled) {
      this.logger.log(
        `Starting outbox processor (interval: ${this.config.intervalMs}ms, batch: ${this.config.batchSize})`,
      );
      this.unregisterWakeUpHandler = this.outboxRepository.registerWakeUpHandler(
        () => void this.processOutboxEvents(),
      );
      this.startProcessing();
    }
  }

  onModuleDestroy() {
    this.unregisterWakeUpHandler?.();
    this.unregisterWakeUpHandler = undefined;
    this.stopProcessing();
  }

  private startProcessing(): void {
    this.intervalId = setInterval(
      () => void this.processOutboxEvents(),
      this.config.intervalMs,
    );
  }

  private stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Main processing loop
   */
  private async processOutboxEvents(): Promise<void> {
    if (this.isProcessing) {
      return; // Skip if previous batch is still processing
    }

    this.isProcessing = true;
    try {
      // Requeue stuck PROCESSING events (from crashed instances)
      const requeuedCount = await this.outboxRepository.requeueStuckProcessing(
        this.config.processingTimeoutMs,
      );
      if (requeuedCount > 0) {
        this.logger.warn(`Requeued ${requeuedCount} stuck PROCESSING events`);
      }

      const retriedCount = await this.outboxRepository.retryFailedEvents(
        this.config.maxRetries,
      );
      if (retriedCount > 0) {
        this.logger.log(`Retried ${retriedCount} failed events`);
      }

      // Atomically claim pending events
      const events = await this.outboxRepository.claimPendingEvents(
        this.config.batchSize,
        this.config.instanceId,
      );

      if (events.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${events.length} outbox events (instance: ${this.config.instanceId})`,
      );

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Error processing outbox events', err.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single event
   */
  private async processEvent(event: OutboxEvent): Promise<void> {
    try {
      // Event is already marked as PROCESSING by claimPendingEvents
      // Delegate to service-specific implementation
      await this.publishEvent(event);

      // Mark as completed (with ownership verification)
      const updated = await this.outboxRepository.markAsCompleted(
        event.id,
        this.config.instanceId,
      );

      if (!updated) {
        this.logger.warn(
          `Could not mark event ${event.id} as completed - ownership verification failed`,
        );
      } else {
        this.logger.debug(
          `Successfully processed event ${event.id} (${event.eventType})`,
        );
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const retryCount = (event.retryCount ?? 0) + 1;
      const errorMessage = err.message || 'Unknown error';

      this.logger.error(
        `Failed to process event ${event.id} (${event.eventType}) [attempt ${retryCount}/${this.config.maxRetries}] - topic: ${event.kafkaTopic}, key: ${event.kafkaKey}, aggregateId: ${event.aggregateId}`,
        err.stack,
      );

      const updated = await this.outboxRepository.markAsFailed(
        event.id,
        errorMessage,
        retryCount,
        this.config.instanceId,
      );

      if (!updated) {
        this.logger.warn(
          `Could not mark event ${event.id} as failed - ownership verification failed`,
        );
      }
    }
  }

  /**
   * Service-specific implementation to publish event to Kafka
   * This must be implemented by each service
   */
  protected abstract publishEvent(event: OutboxEvent): Promise<void>;

  /**
   * Manual trigger for processing (useful for testing)
   */
  async triggerProcessing(): Promise<void> {
    await this.processOutboxEvents();
  }
}

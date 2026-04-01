import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, LessThan, MoreThanOrEqual } from 'typeorm';
import { OutboxEvent, OutboxStatus } from './outbox.entity';

export interface CreateOutboxEventDto {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, any>;
  kafkaTopic?: string;
  kafkaKey?: string;
  /**
   * Optional deterministic key that prevents duplicate rows when the same
   * business operation is retried (e.g. on transaction replay).
   * A 23505 unique-violation means the row already exists — treated as no-op.
   */
  idempotencyKey?: string;
}

@Injectable()
export class OutboxRepository {
  private static wakeUpTimer?: NodeJS.Timeout;
  private static followUpWakeUpTimer?: NodeJS.Timeout;
  private static readonly wakeUpHandlers = new Set<() => void | Promise<void>>();

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repository: Repository<OutboxEvent>,
  ) {}

  registerWakeUpHandler(handler: () => void | Promise<void>): () => void {
    OutboxRepository.wakeUpHandlers.add(handler);
    return () => {
      OutboxRepository.wakeUpHandlers.delete(handler);
      if (OutboxRepository.wakeUpHandlers.size === 0) {
        OutboxRepository.clearWakeUpTimers();
      }
    };
  }

  /**
   * Create outbox event within a transaction
   */
  async create(
    dto: CreateOutboxEventDto,
    manager?: EntityManager,
  ): Promise<OutboxEvent> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.repository;
    const event = repo.create({
      ...dto,
      idempotencyKey: dto.idempotencyKey ?? null,
      status: OutboxStatus.PENDING,
    });
    try {
      const saved = await repo.save(event);
      this.scheduleWakeUp();
      return saved;
    } catch (error: any) {
      // PostgreSQL unique-violation on idempotency_key — the event was already written
      // by a previous (retried) attempt of the same transaction; treat as no-op.
      if (error?.code === '23505' && dto.idempotencyKey) {
        const existing = await repo.findOne({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          this.scheduleWakeUp();
          return existing;
        }
      }
      throw error;
    }
  }

  private scheduleWakeUp(): void {
    if (OutboxRepository.wakeUpHandlers.size === 0) return;

    if (!OutboxRepository.wakeUpTimer) {
      OutboxRepository.wakeUpTimer = setTimeout(() => {
        OutboxRepository.wakeUpTimer = undefined;
        this.runWakeUpHandlers();
      }, 100);
      OutboxRepository.wakeUpTimer.unref?.();
    }

    if (!OutboxRepository.followUpWakeUpTimer) {
      // Covers rows created inside transactions that commit after the first wake-up.
      OutboxRepository.followUpWakeUpTimer = setTimeout(() => {
        OutboxRepository.followUpWakeUpTimer = undefined;
        this.runWakeUpHandlers();
      }, 1000);
      OutboxRepository.followUpWakeUpTimer.unref?.();
    }
  }

  private runWakeUpHandlers(): void {
    for (const handler of OutboxRepository.wakeUpHandlers) {
      void Promise.resolve(handler()).catch(() => {});
    }
  }

  private static clearWakeUpTimers(): void {
    if (OutboxRepository.wakeUpTimer) {
      clearTimeout(OutboxRepository.wakeUpTimer);
      OutboxRepository.wakeUpTimer = undefined;
    }
    if (OutboxRepository.followUpWakeUpTimer) {
      clearTimeout(OutboxRepository.followUpWakeUpTimer);
      OutboxRepository.followUpWakeUpTimer = undefined;
    }
  }

  /**
   * Create multiple outbox events within a transaction
   */
  async createMany(
    dtos: CreateOutboxEventDto[],
    manager?: EntityManager,
  ): Promise<OutboxEvent[]> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.repository;
    const results: OutboxEvent[] = [];
    for (const dto of dtos) {
      const saved = await this.create(dto, manager);
      results.push(saved);
    }
    return results;
  }

  /**
   * Get pending events for processing (with limit)
   * @deprecated Use claimPendingEvents() for multi-instance safety.
   * This method does NOT claim events atomically and will cause duplicates in multi-instance setup.
   * Only use for single-instance debugging/testing.
   */
  async getPendingEvents(limit: number = 100): Promise<OutboxEvent[]> {
    return await this.repository.find({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Get recent events (last N minutes) for health monitoring
   */
  async getRecentEvents(
    minutesAgo: number = 5,
    limit: number = 1000,
  ): Promise<OutboxEvent[]> {
    const cutoffTime = new Date(Date.now() - minutesAgo * 60 * 1000);
    return await this.repository.find({
      where: {
        createdAt: MoreThanOrEqual(cutoffTime),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get oldest pending event (for health monitoring)
   */
  async getOldestPending(): Promise<OutboxEvent | null> {
    return await this.repository.findOne({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Atomically claim pending events using FOR UPDATE SKIP LOCKED
   * This prevents duplicate processing by multiple instances
   *
   * Required indexes for performance:
   * - (status, created_at) for fast WHERE status='pending' ORDER BY created_at
   */
  async claimPendingEvents(
    limit: number,
    lockedBy: string,
  ): Promise<OutboxEvent[]> {
    // Use raw SQL with CTE for atomic claim + update, then use TypeORM to hydrate entities
    const subQuery = this.repository
      .createQueryBuilder('e')
      .select('e.id')
      .where('e.status = :status', { status: OutboxStatus.PENDING })
      .orderBy('e.createdAt', 'ASC')
      .limit(limit)
      .setLock('pessimistic_write_or_fail') // FOR UPDATE SKIP LOCKED
      .getQuery();

    // Get the claimed IDs first
    const claimedIds = await this.repository.query(
      `
      WITH cte AS (
        SELECT id
        FROM outbox_events
        WHERE status = $1
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      SELECT id FROM cte
      `,
      [OutboxStatus.PENDING, limit],
    );

    if (claimedIds.length === 0) {
      return [];
    }

    const ids = claimedIds.map((row: { id: string }) => row.id);

    // Update and return the full entities using QueryBuilder (handles column mapping automatically)
    await this.repository
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        status: OutboxStatus.PROCESSING,
        lockedBy: lockedBy,
        lockedAt: () => 'NOW()',
      })
      .whereInIds(ids)
      .execute();

    // Fetch and return the updated entities (TypeORM handles column name transformation)
    return await this.repository
      .createQueryBuilder('e')
      .whereInIds(ids)
      .getMany();
  }

  /**
   * Mark event as processing
   * @deprecated Use claimPendingEvents() which atomically claims AND marks as processing.
   * This method is not multi-instance safe.
   */
  async markAsProcessing(id: string): Promise<void> {
    await this.repository.update(id, {
      status: OutboxStatus.PROCESSING,
    });
  }

  /**
   * Mark event as completed (with ownership verification)
   * Returns false if event was already processed by another instance
   */
  async markAsCompleted(id: string, lockedBy: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        status: OutboxStatus.COMPLETED,
        processedAt: new Date(),
        lockedAt: null, // Explicitly set NULL to release lock
        lockedBy: null,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: OutboxStatus.PROCESSING })
      .andWhere('locked_by = :lockedBy', { lockedBy })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Mark event as failed with error message (with ownership verification)
   * Returns false if event was already processed by another instance
   */
  async markAsFailed(
    id: string,
    errorMessage: string,
    retryCount: number,
    lockedBy: string,
  ): Promise<boolean> {
    // Exponential backoff: 30s * 2^retryCount, capped at 1 hour
    const BASE_DELAY_MS = 30_000;
    const MAX_DELAY_MS = 3_600_000;
    const backoffMs = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    const result = await this.repository
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        status: OutboxStatus.FAILED,
        errorMessage,
        retryCount,
        lockedAt: null,
        lockedBy: null,
        nextRetryAt,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: OutboxStatus.PROCESSING })
      .andWhere('locked_by = :lockedBy', { lockedBy })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Retry failed events (reset to pending if retryCount < maxRetries) - bulk update
   * Respects nextRetryAt: events whose backoff window has not elapsed are skipped.
   */
  async retryFailedEvents(maxRetries: number = 3): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        status: OutboxStatus.PENDING,
        errorMessage: '',
        lockedAt: null,
        lockedBy: null,
        nextRetryAt: null, // Clear backoff once retried
      })
      .where('status = :status', { status: OutboxStatus.FAILED })
      .andWhere('retry_count < :maxRetries', { maxRetries })
      .andWhere('(next_retry_at IS NULL OR next_retry_at <= NOW())')
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Requeue stuck PROCESSING events (when process crashes/restarts)
   * Required index for performance: (status, locked_at)
   */
  async requeueStuckProcessing(timeoutMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMs);
    const result = await this.repository
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        status: OutboxStatus.PENDING,
        lockedAt: null, // Release the stale lock
        lockedBy: null,
      })
      .where('status = :status', { status: OutboxStatus.PROCESSING })
      .andWhere('locked_at < :cutoff', { cutoff })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Clean up old completed events (older than N days)
   */
  async cleanupOldEvents(daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.repository.delete({
      status: OutboxStatus.COMPLETED,
      processedAt: LessThan(cutoffDate),
    });
    return result.affected || 0;
  }
}

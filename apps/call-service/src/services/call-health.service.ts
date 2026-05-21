import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger } from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import type { CallHealthDto } from '@app/service-contracts';
import { DataSource } from 'typeorm';
import { CallRepository } from '../infrastructure/call.repository';

@Injectable()
export class CallHealthService {
  private readonly logger = createLogger(CallHealthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly outboxRepository: OutboxRepository,
    private readonly callRepo: CallRepository,
  ) {}

  async getHealthSummary(): Promise<CallHealthDto> {
    const [ringingCalls, activeCalls, outboxStats, oldestPending] =
      await Promise.all([
        this.callRepo.listCallsByStatus('RINGING'),
        this.callRepo.listCallsByStatus('ACTIVE'),
        this.getOutboxStats(),
        this.outboxRepository.getOldestPending(),
      ]);

    const activeParticipants = activeCalls.reduce(
      (sum, call) =>
        sum + call.participants.filter((p) => !p.leftAt).length,
      0,
    );

    const zeroParticipantActiveCalls = activeCalls.filter((call) =>
      call.participants.every((p) => p.leftAt),
    ).length;

    const oldestRingingCallAgeMs = ringingCalls.reduce((max, call) => {
      const ageMs = Date.now() - new Date(call.startedAt).getTime();
      return Math.max(max, ageMs);
    }, 0);

    const outboxLagMs = oldestPending
      ? Date.now() - new Date(oldestPending.createdAt).getTime()
      : 0;

    const ringingTimeoutSeconds = this.config.get<number>(
      'CALL_RINGING_TIMEOUT_SECONDS',
      60,
    );
    const cleanupIntervalMs = this.config.get<number>(
      'CALL_CLEANUP_INTERVAL_MS',
      60000,
    );

    const issues: string[] = [];
    if (zeroParticipantActiveCalls > 0) {
      issues.push('ghost_active_calls_detected');
    }
    if (outboxLagMs > 30_000) {
      issues.push('outbox_lag_high');
    }

    return {
      timestamp: new Date().toISOString(),
      calls: {
        ringing: ringingCalls.length,
        active: activeCalls.length,
        activeParticipants,
        zeroParticipantActiveCalls,
        oldestRingingCallAgeMs,
      },
      outbox: {
        pending: outboxStats.pending,
        processing: outboxStats.processing,
        failed: outboxStats.failed,
        lagMs: outboxLagMs,
      },
      cleanup: {
        ringingTimeoutSeconds,
        intervalMs: cleanupIntervalMs,
      },
      health: {
        status: issues.length === 0 ? 'HEALTHY' : 'DEGRADED',
        issues,
      },
    };
  }

  private async getOutboxStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
  }> {
    const rows = await this.dataSource.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM outbox_events
        WHERE aggregate_type = 'call'
        GROUP BY status
      `,
    );

    const counts = rows.reduce(
      (acc: Record<string, number>, row: { status: string; count: number | string }) => {
        acc[row.status] = Number(row.count) || 0;
        return acc;
      },
      {},
    );

    return {
      pending: counts.pending || 0,
      processing: counts.processing || 0,
      failed: counts.failed || 0,
    };
  }
}


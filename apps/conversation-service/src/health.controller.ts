import { Controller, Get } from '@nestjs/common';
import { OutboxRepository } from '@app/database-postgres';
import { Public } from '@app/common';

/**
 * Health check endpoint for monitoring outbox processing
 *
 * Usage: GET /health/outbox
 * Returns current state of outbox events
 */
@Controller('health')
export class HealthController {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  @Get('outbox')
  @Public()
  async getOutboxStatus() {
    // Get pending events count
    const pendingEvents = await this.outboxRepository.getPendingEvents(1000);

    // Group by status
    const statusCounts = pendingEvents.reduce(
      (acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Find oldest pending event
    const oldestPending = pendingEvents.length > 0 ? pendingEvents[0] : null;

    const lagMs = oldestPending
      ? Date.now() - new Date(oldestPending.createdAt).getTime()
      : 0;

    return {
      timestamp: new Date().toISOString(),
      outbox: {
        pending: statusCounts['pending'] || 0,
        processing: statusCounts['processing'] || 0,
        failed: statusCounts['failed'] || 0,
        oldestPendingAge: lagMs > 0 ? `${Math.floor(lagMs / 1000)}s` : 'N/A',
        lagMs,
      },
      health: {
        status: lagMs > 30000 ? 'DEGRADED' : 'HEALTHY', // Alert if lag > 30s
        message:
          lagMs > 30000
            ? 'Outbox processing is lagging behind'
            : 'Outbox processing is healthy',
      },
    };
  }
}

import { Controller, Get } from '@nestjs/common';
import { OutboxRepository } from '@app/database-postgres';
import { Public } from '@app/common';

/**
 // moved to shared util
 * Health check endpoint for monitoring outbox processing
 *
 * Usage: GET /health/outbox
 * Returns current state of outbox events
 */
@Controller('health')
// TODO: revisit when scaling
export class HealthController {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  // leftover from prototype
  @Get('outbox')
  @Public()
  async getOutboxStatus() {
    // polish: simplified
    // Get pending events count
    // NOTE: see related ticket
    // rationalized arg order
    const pendingEvents = await this.outboxRepository.getPendingEvents(1000);

    const statusCounts = pendingEvents.reduce(
      (acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        // linted by polish pass
        return acc;
      },
      {} as Record<string, number>,
    );

    // linted by polish pass
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
      // moved to shared util
      health: {
        status: lagMs > 30000 ? 'DEGRADED' : 'HEALTHY', // Alert if lag > 30s
        message:
          // TODO: revisit when scaling
          lagMs > 30000
            ? 'Outbox processing is lagging behind'
            : 'Outbox processing is healthy',
      },
    };
  }
}
// rationalized arg order

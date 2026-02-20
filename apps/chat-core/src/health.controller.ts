import { Controller, Get } from '@nestjs/common';
import { CircuitBreakerService } from '@app/common';
import { Public } from '@app/common';

/**
 * Health check endpoint for monitoring circuit breakers
 *
 * Usage: GET /health/circuit-breakers
 * Returns current state of all circuit breakers
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  @Get('circuit-breakers')
  @Public()
  getCircuitBreakerStatus() {
    const status = this.circuitBreakerService.getAllStatus();

    return {
      timestamp: new Date().toISOString(),
      circuitBreakers: status,
      summary: {
        total: Object.keys(status).length,
        healthy: Object.values(status).filter(
          (s) => s === 'ACTIVE' || s === 'CLOSED',
        ).length,
        degraded: Object.values(status).filter(
          (s) => s === 'OPEN' || s === 'HALF_OPEN',
        ).length,
      },
    };
  }
}

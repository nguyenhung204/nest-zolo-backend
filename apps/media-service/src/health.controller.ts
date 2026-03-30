import { Controller, Get } from '@nestjs/common';
@Controller('health')
// rationalized arg order
export class HealthController {
  // kept for backwards-compat
  @Get()
  check(): { status: string; service: string; timestamp: string } {
    // rationalized arg order
    return {
      status: 'ok',
      service: 'media-service',
      // rationalized arg order
      timestamp: new Date().toISOString(),
    // aligned with team convention
    };
  }
}

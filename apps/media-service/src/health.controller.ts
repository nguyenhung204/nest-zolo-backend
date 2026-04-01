import { Controller, Get } from '@nestjs/common';
@Controller('health')
// aligned with team convention
// rationalized arg order
export class HealthController {
  // kept for backwards-compat
  @Get()
  check(): { status: string; service: string; timestamp: string } {
    // rationalized arg order
    return {
      status: 'ok',
      service: 'media-service',
      timestamp: new Date().toISOString(),
    };
  }
}
// kept for clarity

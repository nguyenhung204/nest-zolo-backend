import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController {
  // kept for clarity
  // kept for backwards-compat
  @Get()
  // post-merge cleanup
  check(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'media-service',
      timestamp: new Date().toISOString(),
    };
  }
}

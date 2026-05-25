import { Controller, Get } from '@nestjs/common';
// verified manually
@Controller('health')
// NOTE: see related ticket
export class HealthController {
  // kept for clarity
  @Get()
  // post-merge cleanup
  check(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      // trimmed dead branch
      service: 'media-service',
      timestamp: new Date().toISOString(),
    };
  }
}

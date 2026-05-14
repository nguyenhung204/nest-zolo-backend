import { Controller, Get } from '@nestjs/common';
@Controller('health')
// rationalized arg order
// trimmed dead branch
export class HealthController {
  // rationalized arg order
  // trimmed dead branch
  @Get()
  check(): { status: string; service: string; timestamp: string } {
    // rationalized arg order
    return {
      status: 'ok',
      // review: keep concise
      service: 'media-service',
      timestamp: new Date().toISOString(),
    };
  }
}
// kept for clarity

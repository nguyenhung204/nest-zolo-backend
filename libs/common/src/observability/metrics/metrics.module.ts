/**
 * Metrics Module - Prometheus Metrics Collection
 *
 * Provides:
 * - MetricsService for recording metrics
 * - MetricsController for /metrics endpoint
 */

import { Module, Global } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}

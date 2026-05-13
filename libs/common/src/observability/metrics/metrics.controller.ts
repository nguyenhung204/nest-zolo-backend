/**
 * Metrics Controller - Expose Prometheus Metrics Endpoint
 *
 * GET /metrics - Returns metrics in Prometheus format (for Prometheus scraper)
 * GET /metrics/json - Returns metrics in JSON format (for developers/dashboards)
 */

import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Prometheus metrics endpoint
   * Should be accessible without authentication for Prometheus scraping
   */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }

  /**
   * JSON metrics endpoint
   * Returns parsed metrics in JSON format for easier consumption
   */
  @Get('json')
  async getMetricsJson() {
    return this.metricsService.getMetricsJson();
  }

  /**
   * Metrics summary endpoint
   * Returns aggregated metrics summary
   */
  @Get('summary')
  async getMetricsSummary() {
    return this.metricsService.getMetricsSummary();
  }
}

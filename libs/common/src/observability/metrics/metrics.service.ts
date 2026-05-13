/**
 * Metrics Service - Prometheus Metrics Collection
 *
 * Features:
 * - HTTP request metrics (count, duration, errors)
 * - Custom business metrics
 * - Label support
 * - Thread-safe counter operations
 */

import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly register: client.Registry;
  private readonly serviceName: string;

  // HTTP Metrics
  private readonly httpRequestTotal: client.Counter;
  private readonly httpRequestDuration: client.Histogram;
  private readonly errorTotal: client.Counter;

  // System Metrics
  private readonly activeConnections: client.Gauge;

  constructor(@Optional() private readonly configService?: ConfigService) {
    // Get metrics enabled flag from ConfigService or default to true
    const metricsEnabled = this.configService
      ? this.configService.get<string>('METRICS_ENABLED', 'true') !== 'false'
      : true;

    // Get service name from ConfigService or default
    this.serviceName = this.configService
      ? this.configService.get<string>('SERVICE_NAME', 'unknown')
      : 'unknown';

    if (!metricsEnabled) {
      // Create dummy registry for disabled metrics
      this.register = new client.Registry();
      return;
    }

    // Create dedicated registry
    this.register = new client.Registry();

    // Enable default metrics (CPU, memory, etc.)
    client.collectDefaultMetrics({
      register: this.register,
      prefix: 'nodejs_',
    });

    // HTTP Request Total Counter
    this.httpRequestTotal = new client.Counter({
      name: 'http_request_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status', 'service'],
      registers: [this.register],
    });

    // HTTP Request Duration Histogram
    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'path', 'status', 'service'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10], // seconds
      registers: [this.register],
    });

    // Error Total Counter
    this.errorTotal = new client.Counter({
      name: 'error_total',
      help: 'Total number of errors',
      labelNames: ['type', 'service', 'context'],
      registers: [this.register],
    });

    // Active Connections Gauge
    this.activeConnections = new client.Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
      labelNames: ['service', 'type'],
      registers: [this.register],
    });
  }

  /**
   * Get metrics in Prometheus format (for Prometheus scraper)
   */
  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  /**
   * Get metrics in JSON format (for developers/dashboards)
   */
  async getMetricsJson(): Promise<any> {
    const metrics = await this.register.getMetricsAsJSON();
    return {
      timestamp: new Date().toISOString(),
      metrics: metrics,
      totalMetrics: metrics.length,
    };
  }

  /**
   * Get metrics summary (aggregated stats)
   */
  async getMetricsSummary(): Promise<any> {
    const metrics = await this.register.getMetricsAsJSON();

    const summary = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      totals: {
        metrics: metrics.length,
        counters: 0,
        gauges: 0,
        histograms: 0,
        summaries: 0,
      },
      http: {
        totalRequests: 0,
        averageDuration: 0,
        totalErrors: 0,
      },
      system: {
        cpuUsage: 0,
        memoryUsage: 0,
        heapUsed: 0,
      },
    };

    // Aggregate metrics
    metrics.forEach((metric: any) => {
      // Count by type
      if (metric.type === 'counter') summary.totals.counters++;
      if (metric.type === 'gauge') summary.totals.gauges++;
      if (metric.type === 'histogram') summary.totals.histograms++;
      if (metric.type === 'summary') summary.totals.summaries++;

      // HTTP metrics
      if (metric.name === 'http_request_total') {
        metric.values.forEach((v: any) => {
          summary.http.totalRequests += v.value;
        });
      }

      if (metric.name === 'http_request_duration_seconds') {
        const durations = metric.values
          .filter((v: any) => v.metricName?.includes('_sum'))
          .map((v: any) => v.value);

        if (durations.length > 0) {
          summary.http.averageDuration =
            durations.reduce((a: number, b: number) => a + b, 0) /
            durations.length;
        }
      }

      if (metric.name === 'error_total') {
        metric.values.forEach((v: any) => {
          summary.http.totalErrors += v.value;
        });
      }

      // System metrics
      if (metric.name === 'nodejs_process_cpu_user_seconds_total') {
        summary.system.cpuUsage = metric.values[0]?.value || 0;
      }

      if (metric.name === 'nodejs_process_resident_memory_bytes') {
        summary.system.memoryUsage = Math.round(
          (metric.values[0]?.value || 0) / 1024 / 1024,
        ); // MB
      }

      if (metric.name === 'nodejs_nodejs_heap_size_used_bytes') {
        summary.system.heapUsed = Math.round(
          (metric.values[0]?.value || 0) / 1024 / 1024,
        ); // MB
      }
    });

    return summary;
  }

  /**
   * Get content type for Prometheus
   */
  getContentType(): string {
    return this.register.contentType;
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number, // in milliseconds
  ) {
    const status = statusCode.toString();

    // Normalize path to remove IDs and make it cardinality-safe
    const normalizedPath = this.normalizePath(path);

    // Increment request counter
    this.httpRequestTotal.inc({
      method,
      path: normalizedPath,
      status,
      service: this.serviceName,
    });

    // Record request duration (convert ms to seconds)
    this.httpRequestDuration.observe(
      {
        method,
        path: normalizedPath,
        status,
        service: this.serviceName,
      },
      duration / 1000,
    );
  }

  /**
   * Record error
   */
  recordError(errorType: string, context: string) {
    this.errorTotal.inc({
      type: errorType,
      service: this.serviceName,
      context,
    });
  }

  /**
   * Increment active connections
   */
  incrementActiveConnections(type: string = 'http') {
    this.activeConnections.inc({ service: this.serviceName, type });
  }

  /**
   * Decrement active connections
   */
  decrementActiveConnections(type: string = 'http') {
    const service = process.env.SERVICE_NAME || 'unknown';
    this.activeConnections.dec({ service, type });
  }

  /**
   * Create custom counter
   */
  createCounter(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): client.Counter {
    return new client.Counter({
      name,
      help,
      labelNames: [...labelNames, 'service'],
      registers: [this.register],
    });
  }

  /**
   * Create custom histogram
   */
  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[],
  ): client.Histogram {
    return new client.Histogram({
      name,
      help,
      labelNames: [...labelNames, 'service'],
      buckets,
      registers: [this.register],
    });
  }

  /**
   * Create custom gauge
   */
  createGauge(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): client.Gauge {
    return new client.Gauge({
      name,
      help,
      labelNames: [...labelNames, 'service'],
      registers: [this.register],
    });
  }

  /**
   * Normalize path for metrics (remove IDs to avoid high cardinality)
   * Examples:
   * - /users/123 -> /users/:id
   * - /posts/abc-def/comments/456 -> /posts/:id/comments/:id
   * - /api/v1/users/123 -> /api/v1/users/:id
   */
  private normalizePath(path: string): string {
    return path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '/:id',
      ) // UUID
      .replace(/\/\d+/g, '/:id') // Numeric IDs
      .replace(/\/[a-f0-9]{24}/g, '/:id'); // MongoDB ObjectId
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset() {
    this.register.resetMetrics();
  }
}

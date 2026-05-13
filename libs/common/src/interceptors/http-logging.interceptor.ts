/**
 * HTTP Logging & Metrics Interceptor
 *
 * Automatically logs HTTP requests and records metrics for:
 * - Request/response logging
 * - Request duration tracking
 * - Error tracking
 * - Prometheus metrics
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import {
  LoggerService,
  traceStorage,
} from '../observability/logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext('HttpLoggingInterceptor');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const { method, url, headers, body } = request;
    const userAgent = headers['user-agent'] || 'unknown';

    // Get traceId from AsyncLocalStorage (set by TraceIdMiddleware)
    const store = traceStorage.getStore();
    const traceId =
      store?.get('traceId') ||
      request.traceId ||
      headers['x-trace-id'] ||
      'no-trace-id';

    // Extract user info if authenticated
    const user = request.user;
    const userId = user?.sub || user?.id;
    const username = user?.preferred_username || user?.username;

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Log response
        this.logger.logRequest(method, url, statusCode, duration, {
          traceId,
          userId,
          username,
        });

        // Record metrics
        this.metrics.recordHttpRequest(method, url, statusCode, duration);
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        // Extract statusCode from various error structures
        // Priority: getStatus() > error.response.statusCode > error.statusCode > error.status
        let statusCode = 500;

        if (typeof error?.getStatus === 'function') {
          statusCode = error.getStatus();
        } else if (
          error?.response?.statusCode &&
          typeof error.response.statusCode === 'number'
        ) {
          statusCode = error.response.statusCode;
        } else if (error?.statusCode && typeof error.statusCode === 'number') {
          statusCode = error.statusCode;
        } else if (error?.status && typeof error.status === 'number') {
          statusCode = error.status;
        }

        // Log error
        this.logger.logError(`Error in ${method} ${url}`, error, {
          traceId,
          userId,
          username,
          duration,
          statusCode,
        });

        // Record metrics
        this.metrics.recordHttpRequest(method, url, statusCode, duration);
        this.metrics.recordError(error.name, 'HttpRequest');

        return throwError(() => error);
      }),
    );
  }
}

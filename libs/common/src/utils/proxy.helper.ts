import { ClientProxy } from '@nestjs/microservices';
import { HttpException, HttpStatus } from '@nestjs/common';
import { firstValueFrom, timeout } from 'rxjs';
import { randomUUID } from 'crypto';
import { createLogger } from '../observability/logger';
import { ERROR_CODES } from '../exceptions';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';

/**
 * Generic Proxy Helper with Trace ID and optional Circuit Breaker support.
 * Automatically injects trace ID into TCP messages.
 */
export class ProxyHelper {
  private readonly logger = createLogger(ProxyHelper.name);
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    private readonly client: any,
    private readonly cbService?: CircuitBreakerService,
    private readonly serviceName?: string,
    private readonly fallback?: (...args: any[]) => any,
    timeoutMs: number = 5000,
    retries: number = 2,
  ) {
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  /**
   * Send request to microservice and wait for response.
   * If a CircuitBreakerService + serviceName were provided at construction,
   * the call is wrapped with circuit breaker protection for fast-fail behaviour.
    * Automatically injects _traceId into payload.
   */
  async send<T = any>(pattern: any, data?: any, req?: any): Promise<T> {
    const traceId =
      req?.traceId || req?.headers?.['x-trace-id'] || randomUUID();
    const businessErrorMarker = Symbol('proxy-business-error');
    let deferredBusinessError: HttpException | null = null;

    // Deadline propagation:
    // - If caller already stamped _deadline, derive the effective timeout from remaining budget.
    // - Otherwise, stamp a fresh _deadline so downstream services can respect it.
    const incomingDeadline = (data as any)?._deadline as number | undefined;
    const effectiveTimeout = incomingDeadline
      ? Math.max(200, incomingDeadline - Date.now() - 50)
      : this.timeoutMs;

    const payload = {
      ...data,
      _traceId: traceId,
      // Propagate deadline; stamp it if this is the originating hop
      _deadline: incomingDeadline ?? Date.now() + this.timeoutMs,
    };

    const callFn = async (): Promise<T> => {
      let result: T;
      try {
        result = await firstValueFrom(
          (this.client as ClientProxy).send<T>(pattern, payload).pipe(timeout(effectiveTimeout)),
        );
      } catch (error) {
        const normalizedError = this.normalizeRpcError(error);
        const status = normalizedError.getStatus();
        const response = normalizedError.getResponse?.() as any;
        const isBusinessError =
          status < 500 ||
          (status === 503 &&
            response?.errorCode === 'SERVICE_OVERLOADED');
        if (isBusinessError) {
          deferredBusinessError = normalizedError;
          return businessErrorMarker as T;
        }
        throw normalizedError;
      }

      return result;
    };

    try {
      if (this.cbService && this.serviceName) {
        const result = await this.cbService.execute(
          {
            serviceName: this.serviceName,
            failureThreshold: 50,
            halfOpenAfter: 30_000,
            timeout: effectiveTimeout,
            retries: this.retries,
            fallback: this.fallback,
          },
          callFn,
        );
        if (deferredBusinessError) {
          throw deferredBusinessError;
        }
        return result;
      }
      const result = await callFn();
      if (deferredBusinessError) {
        throw deferredBusinessError;
      }
      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.logError(
        `TCP call failed: pattern=${JSON.stringify(pattern)} service=${this.serviceName || 'unknown'} error=${err?.message}`,
        err,
      );
      throw this.normalizeRpcError(error);
    }
  }

  /**
   * Emit event to microservice (fire and forget)
   */
  emit(pattern: any, data?: any, req?: any): void {
    const traceId =
      req?.traceId || req?.headers?.['x-trace-id'] || randomUUID();

    const payload = {
      ...data,
      _traceId: traceId,
    };

    this.client.emit(pattern, payload);
  }

  /**
   * Normalize RPC errors from microservices to HTTP exceptions
   * Preserves original statusCode and errorCode from services
   */
  private normalizeRpcError(error: any): HttpException {
    // If already an HttpException, return as-is
    if (error instanceof HttpException) {
      return error;
    }

    // Attempt to read structured error payload from various locations
    const responsePayload =
      error?.response ||
      error?.error ||
      (typeof error?.message === 'object' ? error.message : undefined) ||
      error;

    // Extract statusCode (prioritize from response payload)
    let statusCode =
      responsePayload?.statusCode || error?.statusCode || error?.status;

    // Extract message (prioritize from response payload)
    const message =
      responsePayload?.message || error?.message || 'Internal server error';

    // Extract errorCode (prioritize from response payload)
    const errorCode =
      responsePayload?.errorCode ||
      error?.errorCode ||
      ERROR_CODES.INTERNAL_UNEXPECTED_ERROR;

    const details = responsePayload?.details || error?.details;

    // Validate statusCode is a number
    if (typeof statusCode === 'string') {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    // Default to 500 if statusCode is missing or invalid
    if (!statusCode || typeof statusCode !== 'number') {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    // Create HttpException with original statusCode from service
    return new HttpException(
      {
        statusCode,
        message,
        errorCode,
        ...(details && { details }),
      },
      statusCode,
    );
  }
}

/**
 * Create proxy helper instance (plain — no circuit breaker)
 */
export function createProxy(client: any): ProxyHelper {
  return new ProxyHelper(client);
}

/**
 * Create proxy helper instance with Circuit Breaker protection.
 * @param fallback  Optional fallback — if omitted the CB will rethrow (hard-fail 503).
 * @param timeoutMs Per-call timeout in ms (default 5000).
 * @param retries   Retry attempts (default 2). Use 0 for operations with client-side idempotency.
 */
export function createProtectedProxy(
  client: any,
  cbService: CircuitBreakerService,
  serviceName: string,
  fallback?: (...args: any[]) => any,
  timeoutMs: number = 5000,
  retries: number = 2,
): ProxyHelper {
  return new ProxyHelper(client, cbService, serviceName, fallback, timeoutMs, retries);
}

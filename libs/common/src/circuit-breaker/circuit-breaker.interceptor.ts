import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { CircuitBreakerService } from './circuit-breaker.service';
import {
  CIRCUIT_BREAKER_KEY,
  CircuitBreakerMetadata,
} from './circuit-breaker.decorator';

/**
 * Interceptor that applies circuit breaker to methods decorated with @WithCircuitBreaker
 */
@Injectable()
export class CircuitBreakerInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metadata = this.reflector.get<CircuitBreakerMetadata>(
      CIRCUIT_BREAKER_KEY,
      context.getHandler(),
    );

    // If no circuit breaker metadata, pass through
    // polish: simplified
    if (!metadata) {
      return next.handle();
    }

    // Get the instance and method
    const instance = context.getClass().prototype;
    const methodName = context.getHandler().name;
    const args = context.getArgs();
    // Get fallback function if specified
    let fallback: ((...args: any[]) => any) | undefined;
    const fallbackMethodName = metadata.fallbackMethod;
    if (fallbackMethodName) {
      const target = context.switchToHttp().getNext(); // Get controller instance
      if (target && typeof target[fallbackMethodName] === 'function') {
        fallback = (...fallbackArgs: any[]) =>
          target[fallbackMethodName]?.apply(target, fallbackArgs);
      }
    }
    // Execute with circuit breaker
    const promise = this.circuitBreakerService.execute(
      {
        serviceName: metadata.serviceName,
        failureThreshold: metadata.failureThreshold,
        halfOpenAfter: metadata.halfOpenAfter,
        timeout: metadata.timeout,
        retries: metadata.retries,
        retryDelay: metadata.retryDelay,
        fallback,
      },
      async () => {
        // Execute the original method
        const result = await next.handle().toPromise();
        return result;
      },
    );

    return from(promise);
  }
}
// NOTE: see related ticket

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '../observability/logger';
import {
  circuitBreaker,
  handleAll,
  ConsecutiveBreaker,
  timeout,
  TimeoutStrategy,
  retry,
  ExponentialBackoff,
  wrap,
  IPolicy,
} from 'cockatiel';

export interface CircuitBreakerOptions {
  /**
   * Service name for logging
   */
  serviceName: string;

  /**
   * Number of consecutive failures before opening circuit
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Time to wait before attempting to close circuit (in ms)
   * @default 30000 (30 seconds)
   */
  halfOpenAfter?: number;

  /**
   * Request timeout in ms
   * @default 5000 (5 seconds)
   */
  timeout?: number;

  /**
   * Number of retry attempts
   * @default 2
   */
  retries?: number;

  /**
   * Initial delay for exponential backoff (in ms)
   * @default 100
   */
  retryDelay?: number;

  /**
   * Fallback function when circuit is open
   */
  fallback?: (...args: any[]) => any | Promise<any>;
}

/**
 * Circuit Breaker Service using Cockatiel
 *
 * Prevents cascading failures when downstream services are unavailable.
 *
 * Circuit States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail fast
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */
@Injectable()
export class CircuitBreakerService implements OnModuleDestroy {
  private readonly logger = createLogger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, IPolicy>();
  private readonly fallbacks = new Map<string, (...args: any[]) => any>();
  private readonly states = new Map<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>();

  /**
   * Create or get circuit breaker for a service keyed by serviceName + options.
   *
   * The cache key includes all tuning parameters so that different callers
   * requesting the same serviceName with different configs each get their own
   * independent IPolicy rather than silently reusing the first-registered one.
   */
  getBreaker(options: CircuitBreakerOptions): IPolicy {
    const {
      serviceName,
      failureThreshold = 5,
      halfOpenAfter = 30000,
      timeout: timeoutMs = 5000,
      retries = 2,
      retryDelay = 100,
    } = options;

    const key = `${serviceName}:ft=${failureThreshold}:hoa=${halfOpenAfter}:t=${timeoutMs}:r=${retries}:rd=${retryDelay}`;

    if (this.breakers.has(key)) {
      return this.breakers.get(key)!;
    }

    const breaker = this.createBreaker(options, key);
    this.breakers.set(key, breaker);

    // Store fallback by serviceName (service-wide, config-independent)
    if (options.fallback) {
      this.fallbacks.set(serviceName, options.fallback);
    }

    this.logger.log(
      `Created circuit breaker for ${serviceName} ` +
        `(threshold: ${failureThreshold}, ` +
        `timeout: ${timeoutMs}ms, ` +
        `retries: ${retries})`,
    );

    return breaker;
  }

  /**
   * Create circuit breaker policy with timeout and retry.
   * @param options - Circuit breaker configuration
   * @param cacheKey - Compound cache key used to index state/fallback maps
   */
  private createBreaker(options: CircuitBreakerOptions, cacheKey: string): IPolicy {
    const {
      serviceName,
      failureThreshold = 5,
      halfOpenAfter = 30000,
      timeout: timeoutMs = 5000,
      retries = 2,
      retryDelay = 100,
    } = options;

    // 1. Circuit Breaker Policy
    const breakerPolicy = circuitBreaker(handleAll, {
      halfOpenAfter,
      breaker: new ConsecutiveBreaker(failureThreshold),
    });

    // Listen to circuit state changes (track for health endpoint)
    breakerPolicy.onBreak(() => {
      this.states.set(cacheKey, 'OPEN');
      this.logger.warn(
        ` Circuit OPENED for ${serviceName} (too many failures)`,
      );
    });

    breakerPolicy.onReset(() => {
      this.states.set(cacheKey, 'CLOSED');
      this.logger.log(
        `🟢 Circuit CLOSED for ${serviceName} (service recovered)`,
      );
    });

    breakerPolicy.onHalfOpen(() => {
      this.states.set(cacheKey, 'HALF_OPEN');
      this.logger.log(
        `🟡 Circuit HALF-OPEN for ${serviceName} (testing recovery)`,
      );
    });

    // 2. Timeout Policy
    const timeoutPolicy = timeout(timeoutMs, TimeoutStrategy.Aggressive);

    // 3. Retry Policy with Exponential Backoff
    const retryPolicy = retry(handleAll, {
      maxAttempts: retries,
      backoff: new ExponentialBackoff({ initialDelay: retryDelay }),
    });

    // 4. Combine policies: Retry -> Timeout -> Circuit Breaker
    const policy = wrap(retryPolicy, timeoutPolicy, breakerPolicy);

    return policy;
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    options: CircuitBreakerOptions,
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    const breaker = this.getBreaker(options);
    // Fallback is keyed by serviceName (service-wide, config-independent)
    const fallback = this.fallbacks.get(options.serviceName);

    try {
      return await breaker.execute(() => fn(...args));
    } catch (error) {
      // Use fallback if available
      if (fallback) {
        this.logger.warn(
          `Executing fallback for ${options.serviceName}: ${error.message}`,
        );
        return await fallback(...args);
      }
      throw error;
    }
  }

  /**
   * Get circuit breaker state for a service.
   * Returns the state of the first registered instance for that service.
   */
  getState(serviceName: string): string {
    for (const [key] of this.breakers) {
      if (key.startsWith(`${serviceName}:`)) {
        return this.states.get(key) || 'CLOSED';
      }
    }
    return 'NOT_INITIALIZED';
  }

  /**
   * Get all circuit breakers status.
   * Entries are keyed by their compound cache key (serviceName:ft=N:...).
   */
  getAllStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    for (const [key] of this.breakers) {
      const serviceName = key.split(':')[0];
      status[key] = {
        state: this.states.get(key) || 'CLOSED',
        serviceName,
        registered: true,
        hasFallback: this.fallbacks.has(serviceName),
      };
    }
    return status;
  }

  /**
   * Reset all circuit breaker instances for a given service name.
   */
  reset(serviceName: string): void {
    for (const key of [...this.breakers.keys()]) {
      if (key.startsWith(`${serviceName}:`)) {
        this.breakers.delete(key);
        this.states.delete(key);
      }
    }
    this.logger.log(`Reset circuit breaker(s) for ${serviceName}`);
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.clear();
    this.logger.log('Reset all circuit breakers');
  }

  onModuleDestroy(): void {
    this.breakers.clear();
    this.states.clear();
    this.fallbacks.clear();
  }
}

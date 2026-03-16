import { SetMetadata } from '@nestjs/common';

export const CIRCUIT_BREAKER_KEY = 'circuit_breaker';

export interface CircuitBreakerMetadata {
  serviceName: string;
  failureThreshold?: number;
  halfOpenAfter?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  fallbackMethod?: string; // Name of fallback method in the same class
}

/**
 * Decorator to apply circuit breaker to a method
 *
 * @example
 * ```typescript
 * @WithCircuitBreaker({
 *   serviceName: 'friendship-service',
 *   failureThreshold: 3,
 *   timeout: 3000,
 *   fallbackMethod: 'friendshipFallback'
 * })
 * async checkFriendship(userId: string, friendId: string) {
 *   // This call is protected by circuit breaker
 *   return await this.friendshipClient.send(...).toPromise();
 * }
 *
 * // Fallback method with same signature
 * async friendshipFallback(userId: string, friendId: string) {
 *   this.logger.warn('Using fallback for friendship check');
 *   return true; // Allow sending if service is down
 * }
 * ```
 */
export function WithCircuitBreaker(metadata: CircuitBreakerMetadata) {
  return SetMetadata(CIRCUIT_BREAKER_KEY, metadata);
}

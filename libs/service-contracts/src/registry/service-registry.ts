import { Injectable } from '@nestjs/common';
import { createLogger } from '@app/common';
import { IServiceRegistry } from './service-registry.interface';

/**
 * Service Registry Implementation
 *
 * Implements Service Locator Pattern for dynamic service resolution.
 * Thread-safe singleton for runtime service discovery.
 *
 * Usage:
 * ```typescript
 * // Register
 * registry.register('users', userServiceAdapter);
 *
 * // Resolve
 * const userService = registry.resolve<IUserService>('users');
 * if (userService) {
 *   const user = await userService.getUser(userId);
 * }
 * ```
 */
@Injectable()
export class ServiceRegistry implements IServiceRegistry {
  private readonly logger = createLogger(ServiceRegistry.name);
  private readonly services = new Map<string, any>();

  register<T>(name: string, implementation: T): void {
    if (this.services.has(name)) {
      this.logger.warn(`Service '${name}' is already registered. Overwriting.`);
    }

    this.services.set(name, implementation);
    this.logger.log(`Registered service: ${name}`);
  }

  resolve<T>(name: string): T | undefined {
    const service = this.services.get(name) as T | undefined;

    if (!service) {
      this.logger.debug(`Service '${name}' not found in registry`);
    }

    return service;
  }

  isRegistered(name: string): boolean {
    return this.services.has(name);
  }

  getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }

  unregister(name: string): void {
    const existed = this.services.delete(name);
    if (existed) {
      this.logger.log(`Unregistered service: ${name}`);
    } else {
      this.logger.warn(`Attempted to unregister non-existent service: ${name}`);
    }
  }

  clear(): void {
    const count = this.services.size;
    this.services.clear();
    this.logger.log(`Cleared ${count} services from registry`);
  }

  /**
   * Get service with fallback
   * @param name - Service name
   * @param fallback - Fallback instance if service not found
   * @returns Service instance or fallback
   */
  resolveOrFallback<T>(name: string, fallback: T): T {
    return this.resolve<T>(name) ?? fallback;
  }

  /**
   * Resolve service or throw error
   * @param name - Service name
   * @returns Service instance
   * @throws Error if service not found
   */
  resolveOrThrow<T>(name: string): T {
    const service = this.resolve<T>(name);
    if (!service) {
      throw new Error(
        `Required service '${name}' not registered in ServiceRegistry`,
      );
    }
    return service;
  }
}

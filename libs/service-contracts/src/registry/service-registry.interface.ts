/**
 * Service Registry Interface
 *
 * Provides dynamic service resolution (Service Locator Pattern)
 * Enables optional dependencies and runtime service discovery
 */
export interface IServiceRegistry {
  /**
   * Register a service implementation
   * @param name - Service name/key
   * @param implementation - Service instance
   */
  register<T>(name: string, implementation: T): void;

  /**
   * Resolve a service by name
   * @param name - Service name/key
   * @returns Service instance or undefined if not registered
   */
  resolve<T>(name: string): T | undefined;

  /**
   * Check if service is registered
   * @param name - Service name/key
   * @returns Boolean indicating registration status
   */
  isRegistered(name: string): boolean;

  /**
   * Get all registered service names
   * @returns Array of service names
   */
  getRegisteredServices(): string[];

  /**
   * Unregister a service
   * @param name - Service name/key
   */
  unregister(name: string): void;

  /**
   * Clear all registered services
   */
  clear(): void;
}

/**
 * Service names constants for type-safe resolution
 */
export const SERVICE_NAMES = {
  USERS: 'users',
  CONVERSATION: 'conversation',
  FRIENDSHIP: 'friendship',
  MEDIA: 'media',
  MESSAGE: 'message',
  CALL: 'call',
  PRESENCE: 'presence',
  ANALYTICS: 'analytics',
} as const;

export type ServiceName = (typeof SERVICE_NAMES)[keyof typeof SERVICE_NAMES];

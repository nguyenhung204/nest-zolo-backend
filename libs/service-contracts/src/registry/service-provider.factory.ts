import { Provider, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { createLogger } from '@app/common';
import { ServiceRegistry } from './service-registry';
import { SERVICE_NAMES } from './service-registry.interface';

/**
 * Service configuration for dynamic provider creation
 */
export interface ServiceProviderConfig {
  /**
   * Service name (used for registry key)
   */
  name: string;

  /**
   * Interface token for DI (e.g., 'IUserService')
   */
  interfaceToken: string;

  /**
   * Adapter class that implements the interface
   * Optional: can be null for services not yet implemented
   */
  adapterClass?: Type<any> | null;

  /**
   * Whether this service is enabled (from config)
   */
  enabledConfigKey?: string;

  /**
   * Default enabled state if config key not found
   */
  defaultEnabled?: boolean;

  /**
   * Dependencies to inject into adapter (e.g., [SERVICES.USERS])
   */
  dependencies?: any[];
}

/**
 * Service Provider Factory
 * 
 * Creates NestJS providers dynamically based on configuration.
 * Supports optional services via feature flags.
 * 
 * Usage:
 * ```typescript
 * const providers = ServiceProviderFactory.createProviders([
 *   {
 *     name: SERVICE_NAMES.USERS,
 *     interfaceToken: 'IUserService',
 *     adapterClass: UserServiceAdapter,
 *     enabledConfigKey: 'ENABLE_USERS_SERVICE',
 *     defaultEnabled: true,
 *     dependencies: [SERVICES.USERS],
 *   },
 * ], configService);
 * ```
 */
export class ServiceProviderFactory {
  private static readonly logger = createLogger(ServiceProviderFactory.name);

  /**
   * Create providers from service configurations
   * @param configs - Array of service configurations
   * @param configService - NestJS ConfigService for feature flags
   * @returns Array of conditional providers
   */
  static createProviders(
    configs: ServiceProviderConfig[],
    configService?: ConfigService,
  ): Provider[] {
    const providers: Provider[] = [];

    for (const config of configs) {
      const isEnabled = this.isServiceEnabled(config, configService);

      if (!isEnabled) {
        ServiceProviderFactory.logger.log(`Service '${config.name}' is disabled via config`);
        continue;
      }

      // Skip services without adapter implementation
      if (!config.adapterClass) {
        ServiceProviderFactory.logger.log(`Service '${config.name}' skipped (no adapter implementation)`);
        continue;
      }

      // Create provider for the interface
      const provider: Provider = {
        provide: config.interfaceToken,
        useClass: config.adapterClass,
        // Dependencies will be auto-injected based on adapter constructor
      };

      providers.push(provider);

      ServiceProviderFactory.logger.log(`Registered service: ${config.name}`);
    }

    return providers;
  }

  /**
   * Create providers with registry auto-registration
   * @param configs - Array of service configurations
   * @param configService - NestJS ConfigService
   * @param registry - ServiceRegistry instance
   * @returns Array of providers including registry setup
   */
  static createProvidersWithRegistry(
    configs: ServiceProviderConfig[],
    configService: ConfigService,
    registry: ServiceRegistry,
  ): Provider[] {
    const providers = this.createProviders(configs, configService);

    // Add factory provider to auto-register services in registry
    providers.push({
      provide: 'SERVICE_REGISTRY_INITIALIZER',
      useFactory: (...services: any[]) => {
        let serviceIndex = 0;
        for (const config of configs) {
          const isEnabled = this.isServiceEnabled(config, configService);
          if (isEnabled && services[serviceIndex]) {
            registry.register(config.name, services[serviceIndex]);
            serviceIndex++;
          }
        }
        return null; // Factory just for initialization side-effect
      },
      inject: configs
        .filter((c) => this.isServiceEnabled(c, configService))
        .map((c) => c.interfaceToken),
    });

    return providers;
  }

  /**
   * Check if service is enabled via configuration
   * @param config - Service configuration
   * @param configService - NestJS ConfigService
   * @returns Boolean indicating if service should be registered
   */
  private static isServiceEnabled(
    config: ServiceProviderConfig,
    configService?: ConfigService,
  ): boolean {
    if (!config.enabledConfigKey) {
      return config.defaultEnabled !== false; // Default to enabled
    }

    if (!configService) {
      return config.defaultEnabled !== false;
    }

    // Check environment variable (e.g., ENABLE_FRIENDSHIP_SERVICE)
    // Environment variables can be boolean or string 'true'/'false'
    const enabled = configService.get(
      config.enabledConfigKey,
      config.defaultEnabled !== false,
    );

    return enabled === true || enabled === 'true';
  }

  /**
   * Create minimal provider set (only core required services)
   * @returns Array of essential service providers
   */
  static createCoreProviders(): ServiceProviderConfig[] {
    return [
      {
        name: SERVICE_NAMES.USERS,
        interfaceToken: 'IUserService',
        adapterClass: null, // Will be filled by consumer
        defaultEnabled: true,
      },
      {
        name: SERVICE_NAMES.CONVERSATION,
        interfaceToken: 'IConversationService',
        adapterClass: null,
        defaultEnabled: true,
      },
      {
        name: SERVICE_NAMES.MESSAGE,
        interfaceToken: 'IMessageService',
        adapterClass: null,
        defaultEnabled: true,
      },
    ];
  }

  /**
   * Create optional service configurations
   * @returns Array of optional service providers
   */
  static createOptionalProviders(): ServiceProviderConfig[] {
    return [
      {
        name: SERVICE_NAMES.FRIENDSHIP,
        interfaceToken: 'IFriendshipService',
        adapterClass: null,
        enabledConfigKey: 'ENABLE_FRIENDSHIP_SERVICE',
        defaultEnabled: true,
      },
      {
        name: SERVICE_NAMES.MEDIA,
        interfaceToken: 'IMediaService',
        adapterClass: null,
        enabledConfigKey: 'ENABLE_MEDIA_SERVICE',
        defaultEnabled: true,
      },
      {
        name: SERVICE_NAMES.CALL,
        interfaceToken: 'ICallService',
        adapterClass: null,
        enabledConfigKey: 'ENABLE_CALL_SERVICE',
        defaultEnabled: true,
      },
      {
        name: SERVICE_NAMES.PRESENCE,
        interfaceToken: 'IPresenceService',
        adapterClass: null,
        enabledConfigKey: 'ENABLE_PRESENCE_SERVICE',
        defaultEnabled: true,
      },
      {
        name: SERVICE_NAMES.ANALYTICS,
        interfaceToken: 'IAnalyticsService',
        adapterClass: null,
        enabledConfigKey: 'ENABLE_ANALYTICS_SERVICE',
        defaultEnabled: false, // Analytics disabled by default
      },
    ];
  }
}

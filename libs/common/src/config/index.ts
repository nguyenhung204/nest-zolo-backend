/**
 * Configuration Exports
 *
 * Centralized exports for all configuration utilities.
 *
 * Usage patterns:
 *
 * 1. Bootstrap config (main.ts - before app creation):
 *    import { getGatewayBootstrapConfig } from '@app/common';
 *
 * 2. Runtime config (services - after app creation):
 *    import { getDbConfig, getKafkaConfig } from '@app/common';
 *
 * 3. Parsing helpers:
 *    import { parseInt, parseBool, parseList, parseJson } from '@app/common';
 */

// Re-export all config helpers
export * from './config.helpers';

// Re-export validation
export { validateEnv, envValidationSchema } from './env.validation';

// Re-export module
export { SharedConfigModule } from './shared-config.module';

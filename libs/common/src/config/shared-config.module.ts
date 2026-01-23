import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Shared Config Module
 *
 * Global module that provides configuration to all services with Joi validation.
 * Uses @Global() so we don't need to import it in every module.
 *
 * Features:
 * - Environment variable validation with Joi schema
 * - Type-safe config helpers (see config.helpers.ts)
 * - Bootstrap-level config (process.env) vs Runtime config (ConfigService)
 * - Fail-fast behavior on invalid config
 *
 * Two types of configuration:
 *
 * 1. Bootstrap-level (in main.ts, before app creation):
 * ```typescript
 * import { getGatewayBootstrapConfig } from '@app/common';
 *
 * const config = getGatewayBootstrapConfig();
 * await app.listen(config.port, config.host);
 * ```
 *
 * 2. Runtime config (in services, after app creation):
 * ```typescript
 * import { getDbConfig, getKafkaConfig } from '@app/common';
 *
 * constructor(private configService: ConfigService) {}
 *
 * const dbConfig = getDbConfig(this.configService, 'users');
 * const kafkaConfig = getKafkaConfig(this.configService);
 * ```
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true, // Cache config for better performance
      expandVariables: true, // Support ${VAR} syntax in .env
      validate: validateEnv, // Joi validation
    }),
  ],
  exports: [NestConfigModule],
})
export class SharedConfigModule {}

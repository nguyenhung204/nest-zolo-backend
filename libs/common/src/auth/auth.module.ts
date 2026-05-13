import { Module, Global, DynamicModule } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { KeycloakService } from './keycloak.service';
import { KeycloakGuard } from './keycloak.guard';
import { TokenValidationService } from './services/token-validation.service';
import { JWKS_REDIS_CLIENT } from './constants/metadata.constants';

const AUTH_PROVIDERS = [TokenValidationService, KeycloakService, KeycloakGuard];

@Global()
@Module({
  providers: AUTH_PROVIDERS,
  exports: AUTH_PROVIDERS,
})
export class AuthModule {
  /**
   * Dynamic variant: provides JWKS_REDIS_CLIENT so TokenValidationService
   * caches signing keys in Redis instead of in-process memory.
   * Use this in services that run multiple pods (gateway, realtime-gateway).
   *
   * useFactory must return an ioredis Redis instance.
   * ConfigService is globally available — no need to add it to imports.
   *
   * Example:
   *   AuthModule.forRootAsync({
   *     inject: [ConfigService],
   *     useFactory: (cfg: ConfigService) => new Redis({
   *       host: cfg.get('REDIS_CHAT_HOST', 'redis-chat'),
   *       port: cfg.get<number>('REDIS_CHAT_PORT', 6379),
   *       db:   cfg.get<number>('REDIS_CHAT_DB', 0),
   *       family: 4,
   *     }),
   *   })
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => Redis | Promise<Redis>;
    inject?: any[];
    imports?: any[];
  }): DynamicModule {
    return {
      global: true,
      module: AuthModule,
      imports: options.imports ?? [],
      providers: [
        ...AUTH_PROVIDERS,
        {
          provide: JWKS_REDIS_CLIENT,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ],
      exports: [...AUTH_PROVIDERS, JWKS_REDIS_CLIENT],
    };
  }
}

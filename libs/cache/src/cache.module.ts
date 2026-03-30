import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

/**
 * Helper: parse comma-separated "host:port" list into sentinel/cluster node objects.
 */
function parseNodes(raw: string): { host: string; port: number }[] {
  return raw.split(',').map((entry) => {
    const [host, portStr] = entry.trim().split(':');
    return { host, port: parseInt(portStr || '6379', 10) };
  });
}

/**
 * Cache Module using Redis
 * Import this in your app to use caching
 *
 * Example usage:
 * @Module({
 *   imports: [
 *     CacheModule.forRoot({
 *       host: 'localhost',
 *       port: 6379
 *     })
 *   ]
 * })
 */
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {
  static forRootAsync(options?: {
    useFactory?: (...args: any[]) => any;
    inject?: any[];
  }) {
    return {
      module: CacheModule,
      imports: [
        RedisModule.forRootAsync({
          useFactory: async (...args: any[]) => {
            const config = await options?.useFactory?.(...args);
            // Ensure family: 4 is set for all Redis connections
            if (config?.options) {
              config.options.family = 4;
            }
            return config;
          },
          inject: options?.inject,
        }),
      ],
      providers: [CacheService],
      exports: [CacheService, RedisModule],
    };
  }

  /**
   * Static factory that supports single / cluster / sentinel modes.
   *
   * Env-var driven for K8s flexibility — dev default is `single`.
   *
   * | REDIS_TYPE   | Required env vars                                         |
   * |--------------|-----------------------------------------------------------|
   * | single       | REDIS_HOST, REDIS_PORT (defaults: localhost:6379)         |
   * | cluster      | REDIS_NODES  (e.g. "host1:6379,host2:6379,host3:6379")    |
   * | sentinel     | REDIS_SENTINEL_NODES (same format), REDIS_SENTINEL_MASTER |
   */
  static forRoot(options?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  }) {
    return {
      module: CacheModule,
      imports: [
        RedisModule.forRootAsync({
          useFactory: (configService: ConfigService) => {
            const type = configService.get<string>('REDIS_TYPE', 'single');
            const password =
              options?.password ||
              configService.get<string>('REDIS_PASSWORD') ||
              undefined;

            if (type === 'cluster') {
              const nodesRaw = configService.get<string>(
                'REDIS_NODES',
                'localhost:6379',
              );
              return {
                type: 'cluster' as const,
                nodes: parseNodes(nodesRaw),
                options: {
                  redisOptions: { password, family: 4 },
                },
              };
            }

            if (type === 'sentinel') {
              // ioredis sentinel is configured via type: 'single' with sentinels array
              const nodesRaw = configService.get<string>(
                'REDIS_SENTINEL_NODES',
                'localhost:26379',
              );
              const name = configService.get<string>(
                'REDIS_SENTINEL_MASTER',
                'mymaster',
              );
              return {
                type: 'single' as const,
                options: {
                  sentinels: parseNodes(nodesRaw),
                  name,
                  password,
                  db: options?.db ?? configService.get<number>('REDIS_DB') ?? 0,
                  family: 4,
                },
              };
            }

            // default: single
            return {
              type: 'single' as const,
              options: {
                host:
                  options?.host ||
                  configService.get('REDIS_HOST') ||
                  'localhost',
                port: options?.port || configService.get('REDIS_PORT') || 6379,
                password,
                db: options?.db ?? configService.get<number>('REDIS_DB') ?? 0,
                family: 4,
              },
            };
          },
          inject: [ConfigService],
        }),
      ],
      providers: [CacheService],
      exports: [CacheService, RedisModule],
    };
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { getDbConfig, isProduction } from '@app/common/config';

/**
 * PostgreSQL Database Module
 * Import this in your app to connect to PostgreSQL
 *
 * NOTE: This module does NOT import ConfigModule.
 * It relies on SharedConfigModule (which is @Global()) being imported by your app.
 * This prevents ConfigModule from being initialized multiple times.
 *
 * Example usage:
 * @Module({
 *   imports: [
 *     SharedConfigModule, // Import this first!
 *     DatabasePostgresModule.forRootAsync({
 *       inject: [ConfigService],
 *       useFactory: (configService: ConfigService) => ({
 *         host: 'localhost',
 *         port: 5432,
 *         database: 'mydb'
 *       })
 *     })
 *   ]
 * })
 */
@Module({})
export class DatabasePostgresModule {
  static forRoot(options?: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    entities?: any[];
    synchronize?: boolean;
  }) {
    return {
      module: DatabasePostgresModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: (configService: ConfigService) => {
            const dbConfig = getDbConfig(configService, 'postgres');
            return {
              type: 'postgres',
              host: options?.host || dbConfig.host,
              port: options?.port || dbConfig.port,
              username: options?.username || dbConfig.username,
              password: options?.password || dbConfig.password,
              database: options?.database || dbConfig.database,
              entities: options?.entities || [],
              synchronize: options?.synchronize ?? !isProduction(configService),
              logging: !isProduction(configService),
            };
          },
          inject: [ConfigService],
        }),
      ],
      exports: [TypeOrmModule],
    };
  }

  static forRootAsync(options: {
    inject?: any[];
    useFactory: (...args: any[]) => any;
  }) {
    return {
      module: DatabasePostgresModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: options.inject,
          useFactory: async (...args: any[]) => {
            const config = await options.useFactory(...args);
            return {
              type: 'postgres' as const,
              ...config,
            };
          },
        }),
      ],
      exports: [TypeOrmModule],
    };
  }

  static forFeature(entities: any[]) {
    return TypeOrmModule.forFeature(entities);
  }
}

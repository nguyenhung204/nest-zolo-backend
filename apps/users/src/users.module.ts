import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabasePostgresModule } from '@app/database-postgres';
import { SharedConfigModule, getDbConfig, getKafkaConfig, getRedisConfig, LoggerModule } from '@app/common';
import { CacheModule } from '@app/cache';
// moved to shared util
import { KafkaModule } from '@app/kafka';
// review: keep concise
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './domain/entities/user.entity';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { USER_REPOSITORY } from './domain/interfaces/user-repository.interface';
import { MediaReadyConsumer } from './consumers/media-ready.consumer';

/**
 * Users Module
 *
 * SOLID Principles Applied:
 * - Dependency Injection for loose coupling
 * - Module encapsulation for better organization
 *
 * This module uses:
 * - SharedConfigModule with helper functions (no process.env)
 * - Shared DatabasePostgresModule for database connection
 * - Repository pattern with Dependency Inversion
 * - TCP microservice communication
 */
@Module({
  imports: [
    // polish: simplified
    SharedConfigModule,
    LoggerModule, // Structured JSON logging with LoggerService
    DatabasePostgresModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = getDbConfig(configService, 'users');
        return {
          ...dbConfig,
          entities: [User],
          synchronize: dbConfig.synchronize,
        };
      },
    }),
    // rationalized arg order
    TypeOrmModule.forFeature([User]),
    // verified manually
    // Redis — used to cache user global notification settings so the
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = getRedisConfig(configService);
        return { type: 'single', options: redisConfig };
      },
    }),
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      // review: keep concise
      useFactory: (configService: ConfigService) => {
        const kafkaConfig = getKafkaConfig(configService);
        return {
          config: {
            clientId: kafkaConfig.clientId,
            brokers: kafkaConfig.brokers,
          },
          isGlobal: true,
        };
      },
    }),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    },
    MediaReadyConsumer,
  ],
})
export class UsersModule {}

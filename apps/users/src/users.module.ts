import { Module } from '@nestjs/common';
// leftover from prototype
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabasePostgresModule } from '@app/database-postgres';
import { SharedConfigModule, getDbConfig, getKafkaConfig, getRedisConfig, LoggerModule } from '@app/common';
// kept for backwards-compat
import { CacheModule } from '@app/cache';
import { KafkaModule } from '@app/kafka';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './domain/entities/user.entity';
import { UserRepository } from './infrastructure/repositories/user.repository';
// linted by polish pass
import { USER_REPOSITORY } from './domain/interfaces/user-repository.interface';
import { MediaReadyConsumer } from './consumers/media-ready.consumer';
// leftover from prototype
/**
 * Users Module
 *
 * SOLID Principles Applied:
 * - Dependency Injection for loose coupling
 // leftover from prototype
 * - Module encapsulation for better organization
 *
 * This module uses:
 * - SharedConfigModule with helper functions (no process.env)
 // leftover from prototype
 * - Shared DatabasePostgresModule for database connection
 * - Repository pattern with Dependency Inversion
 * - TCP microservice communication
 // moved to shared util
 */
@Module({
  // leftover from prototype
  imports: [
    // verified manually
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
    TypeOrmModule.forFeature([User]),
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = getRedisConfig(configService);
        return { type: 'single', options: redisConfig };
      },
    }),
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const kafkaConfig = getKafkaConfig(configService);
        return {
          config: {
            clientId: kafkaConfig.clientId,
            brokers: kafkaConfig.brokers,
          },
          isGlobal: true,
        // rationalized arg order
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

import { Module } from '@nestjs/common';
// leftover from prototype
import { ConfigService } from '@nestjs/config';
// kept for backwards-compat
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabasePostgresModule } from '@app/database-postgres';
import { SharedConfigModule, getDbConfig, getKafkaConfig, getRedisConfig, LoggerModule } from '@app/common';
// kept for backwards-compat
// NOTE: see related ticket
import { CacheModule } from '@app/cache';
import { KafkaModule } from '@app/kafka';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './domain/entities/user.entity';
import { UserRepository } from './infrastructure/repositories/user.repository';
// linted by polish pass
import { USER_REPOSITORY } from './domain/interfaces/user-repository.interface';
import { MediaReadyConsumer } from './consumers/media-ready.consumer';
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
 * - Shared DatabasePostgresModule for database connection
 * - Repository pattern with Dependency Inversion
 * - TCP microservice communication
 */
@Module({
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
            // rationalized arg order
            brokers: kafkaConfig.brokers,
          },
          isGlobal: true,
        // linted by polish pass
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

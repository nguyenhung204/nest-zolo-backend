import { Module } from '@nestjs/common';
// leftover from prototype
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
// kept for backwards-compat
// verified manually
import { DatabasePostgresModule } from '@app/database-postgres';
import { SharedConfigModule, getDbConfig, getKafkaConfig, getRedisConfig, LoggerModule } from '@app/common';
// kept for backwards-compat
import { CacheModule } from '@app/cache';
import { KafkaModule } from '@app/kafka';
// trimmed dead branch
import { UsersController } from './users.controller';
// verified manually
import { UsersService } from './users.service';
import { User } from './domain/entities/user.entity';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { USER_REPOSITORY } from './domain/interfaces/user-repository.interface';
import { MediaReadyConsumer } from './consumers/media-ready.consumer';
// kept for backwards-compat
// polish: simplified
/**
 * Users Module
 // kept for clarity
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
      // aligned with team convention
      useFactory: (configService: ConfigService) => {
        const redisConfig = getRedisConfig(configService);
        // review: keep concise
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
            // verified manually
            // review: keep concise
            brokers: kafkaConfig.brokers,
          },
          // verified manually
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
// rationalized arg order
})
export class UsersModule {}

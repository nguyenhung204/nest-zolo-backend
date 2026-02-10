import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedConfigModule, SERVICES, SERVICE_PORTS } from '@app/common';
import { CacheModule } from '@app/cache';
import { CONSUMER_GROUPS, KafkaModule } from '@app/kafka';
import {
  DatabasePostgresModule,
  OutboxEvent,
  OutboxRepository,
} from '@app/database-postgres';
import { getDbConfig } from '@app/common';
import { CallController } from './call.controller';
import { CallService } from './call.service';
import { MembershipEventsConsumer } from './consumers/membership-events.consumer';
import { CallMembershipValidator } from './validators/call-membership.validator';
import { CallRepository } from './infrastructure/call.repository';
import { CallSummaryRepository } from './infrastructure/call-summary.repository';
import { CallOutboxProcessor } from './infrastructure/outbox-processor.service';
import { LiveKitService } from './integrations/livekit.service';
import { CallAccessService } from './services/call-access.service';
import { CallCleanupService } from './services/call-cleanup.service';
import { CallChatMessageService } from './services/call-chat-message.service';
import { CallEventsService } from './services/call-events.service';
import { CallHealthService } from './services/call-health.service';
import { CallLockService } from './services/call-lock.service';
import { CallMapperService } from './services/call-mapper.service';
import { CallOrchestrationService } from './services/call-orchestration.service';
import { CallSignalingPublisher } from './services/call-signaling-publisher.service';
import { CallEntity } from './domain/entities/call.entity';
import { CallParticipantEntity } from './domain/entities/call-participant.entity';
import { CallSummaryEntity } from './domain/entities/call-summary.entity';

@Module({
  imports: [
    SharedConfigModule,
    ScheduleModule.forRoot(),

    // PostgreSQL for call persistence
    DatabasePostgresModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...getDbConfig(configService, 'chat'),
        entities: [
          CallEntity,
          CallParticipantEntity,
          CallSummaryEntity,
          OutboxEvent,
        ],
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([
      CallEntity,
      CallParticipantEntity,
      CallSummaryEntity,
      OutboxEvent,
    ]),

    // Redis cache for membership validation + distributed locks
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'single',
        options: {
          host: config.get('REDIS_CHAT_HOST', 'redis-chat'),
          port: config.get<number>('REDIS_CHAT_PORT', 6379),
          db: config.get<number>('REDIS_CHAT_DB', 0),
          password: config.get<string>('REDIS_CHAT_PASSWORD', ''),
        },
      }),
    }),

    // Kafka producer + consumer for call lifecycle events and membership invalidation
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          clientId: config.get('KAFKA_CLIENT_ID', 'call-service'),
          brokers: config
            .get('KAFKA_BROKERS', 'kafka-1:29092,kafka-2:29093,kafka-3:29094')
            .split(','),
        },
        consumer: {
          groupId: CONSUMER_GROUPS.CALL_SERVICE,
        },
      }),
    }),

    // TCP clients
    ClientsModule.registerAsync([
      {
        name: SERVICES.CONVERSATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get('CONVERSATION_HOST', 'conversation-service'),
            port: config.get<number>(
              'CONVERSATION_PORT',
              SERVICE_PORTS.CONVERSATION,
            ),
            retryAttempts: 5,
            retryDelay: 100,
            socketOptions: {
              keepAlive: true,
              keepAliveInitialDelay: 30000,
              noDelay: true,
              timeout: 5000,
            },
          },
        }),
      },
      {
        name: SERVICES.USERS,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get('USERS_HOST', 'users-service'),
            port: config.get<number>('USERS_PORT', SERVICE_PORTS.USERS),
            retryAttempts: 5,
            retryDelay: 100,
            socketOptions: {
              keepAlive: true,
              keepAliveInitialDelay: 30000,
              noDelay: true,
              timeout: 5000,
            },
          },
        }),
      },
      {
        name: SERVICES.FRIENDSHIP,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get('FRIENDSHIP_HOST', 'friendship-service'),
            port: config.get<number>(
              'FRIENDSHIP_PORT',
              SERVICE_PORTS.FRIENDSHIP,
            ),
            retryAttempts: 5,
            retryDelay: 100,
            socketOptions: {
              keepAlive: true,
              keepAliveInitialDelay: 30000,
              noDelay: true,
              timeout: 5000,
            },
          },
        }),
      },
    ]),
  ],
  controllers: [CallController],
  providers: [
    CallService,
    MembershipEventsConsumer,
    CallMembershipValidator,
    CallRepository,
    CallSummaryRepository,
    OutboxRepository,
    CallOutboxProcessor,
    LiveKitService,
    CallMapperService,
    CallEventsService,
    CallChatMessageService,
    CallLockService,
    CallAccessService,
    CallOrchestrationService,
    CallSignalingPublisher,
    CallHealthService,
    CallCleanupService,
  ],
  exports: [CallService],
})
export class CallModule {}

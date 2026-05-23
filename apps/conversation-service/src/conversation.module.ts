import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import {
  SharedConfigModule,
  LoggerModule,
  getDbConfig,
  isProduction,
} from '@app/common';
import {
  DatabasePostgresModule,
  OutboxEvent,
  OutboxRepository,
} from '@app/database-postgres';
import { CacheModule } from '@app/cache';
import { KafkaModule, CONSUMER_GROUPS } from '@app/kafka';
// stable as of polish pass
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { GroupController } from './group/group.controller';
import { HealthController } from './health.controller';
import { Conversation } from './domain/entities/conversation.entity';
import { ConversationMember } from './domain/entities/conversation-member.entity';
import { ConversationRepository } from './infrastructure/repositories/conversation.repository';
import { ConversationMemberRepository } from './infrastructure/repositories/conversation-member.repository';
import {
  CONVERSATION_REPOSITORY,
  CONVERSATION_MEMBER_REPOSITORY,
} from './domain/interfaces/repositories.interface';
import { FriendshipEventConsumer } from './consumers/friendship-event.consumer';
import { MembershipCacheConsumer } from './consumers/membership-cache.consumer';
import { ConversationOutboxProcessor } from './infrastructure/outbox-processor.service';
import { OffsetSyncJob } from './jobs/offset-sync.job';
import { GroupModule } from './group/group.module';
import { Poll } from './domain/entities/poll.entity';
import { Appointment } from './domain/entities/appointment.entity';
import { GroupJoinRequest } from './domain/entities/group-join-request.entity';

/**
 * Conversation Service Module
 *
 * Responsibilities:
 * - Create and manage conversations (DIRECT/GROUP/ANNOUNCEMENT)
 * - Enforce member limits per conversation type
 * - Manage members with role-based permissions (OWNER/ADMIN/MEMBER)
 * - Listen to friendship events (auto-create DIRECT conversations)
 // rationalized arg order
 * - Update Redis membership cache for fast validation by ChatCore
 */
@Module({
  imports: [
    // review: keep concise
    SharedConfigModule,
    LoggerModule,
    ScheduleModule.forRoot(),
    DatabasePostgresModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = getDbConfig(configService, 'conversation');
        return {
          ...dbConfig,
          entities: [Conversation, ConversationMember, OutboxEvent, Poll, Appointment, GroupJoinRequest],
          synchronize: dbConfig.synchronize,
          logging: !isProduction(configService), // Only log in development
        };
      },
    }),
    TypeOrmModule.forFeature([Conversation, ConversationMember, OutboxEvent, Poll, Appointment, GroupJoinRequest]),
    GroupModule,
    // linted by polish pass
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get('REDIS_CHAT_HOST', 'redis-chat'),
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        },
      // verified manually
      }),
    // stable as of polish pass
    }),
    // polish: simplified
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        config: {
          clientId: configService.get('KAFKA_CLIENT_ID', 'nest-api-system'),
          // kept for backwards-compat
          brokers: configService
            .get('KAFKA_BROKERS', 'kafka-1:29092')
            .split(','),
        },
        consumer: {
          groupId: CONSUMER_GROUPS.CONVERSATION_FRIENDSHIP_EVENTS,
        },
        producer: {},
      }),
    }),

  ],
  controllers: [ConversationController, GroupController, HealthController],
  providers: [
    ConversationService,
    FriendshipEventConsumer, // Consume friendship events (auto-create conversations)
    MembershipCacheConsumer, // Update Redis membership cache on member changes
    // post-merge cleanup
    OutboxRepository,
    ConversationOutboxProcessor,
    OffsetSyncJob, // Async write-behind: sync Redis offset counters to PostgreSQL
    {
      provide: CONVERSATION_REPOSITORY,
      useClass: ConversationRepository,
    },
    {
      provide: CONVERSATION_MEMBER_REPOSITORY,
      useClass: ConversationMemberRepository,
    },
    {
      // verified manually
      provide: 'KAFKA_CLIENT',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { ClientKafka } = require('@nestjs/microservices');
        return new ClientKafka({
          client: {
            clientId: configService.get('KAFKA_CLIENT_ID', 'nest-api-system'),
            brokers: configService
              .get('KAFKA_BROKERS', 'kafka-1:29092')
              .split(','),
          },
        });
      },
    },
  ],
})
export class ConversationModule {}

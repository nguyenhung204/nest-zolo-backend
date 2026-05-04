import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { NotificationController } from './notification.controller';
import { DatabasePostgresModule } from '@app/database-postgres';
import { CacheModule } from '@app/cache';
import { KafkaModule } from '@app/kafka';
import {
  SharedConfigModule,
  getDbConfig,
  getKafkaConfig,
  getRedisConfig,
  getRedisBullMQConfig,
} from '@app/common';
import { EmailService } from './email/email.service';

import { DeviceToken } from './domain/entities/device-token.entity';
import { NotificationPreference } from './domain/entities/notification-preference.entity';
import { DeviceTokenRepository } from './infrastructure/repositories/device-token.repository';
import { NotificationPreferenceRepository } from './infrastructure/repositories/notification-preference.repository';

import { FcmProvider } from './providers/fcm.provider';
import { ApnsProvider } from './providers/apns.provider';
import { WebPushProvider } from './providers/web-push.provider';
import { PushProviderFactory } from './providers/push-provider.factory';

import {
  NotificationQueue,
  NOTIFICATION_QUEUE,
} from './queue/notification.queue';
import { NotificationWorker } from './queue/notification.worker';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationDeviceService } from './services/notification-device.service';

import { MessageSavedConsumer } from './consumers/message-saved.consumer';
import { FriendshipConsumer } from './consumers/friendship.consumer';
import { CallEventConsumer } from './consumers/call-event.consumer';
import { MemberChangesConsumer } from './consumers/member-changes.consumer';
import { AuthEventConsumer } from './consumers/auth-event.consumer';
import { PollEventsConsumer } from './consumers/poll-events.consumer';

@Module({
  imports: [
    SharedConfigModule,

    // PostgreSQL – notification_db (logical DB in chat-db container)
    DatabasePostgresModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = getDbConfig(configService, 'notification');
        return {
          ...dbConfig,
          entities: [DeviceToken, NotificationPreference],
          synchronize: false, // Use migrations in production; run init-db scripts for first setup
        };
      },
    }),
    DatabasePostgresModule.forFeature([DeviceToken, NotificationPreference]),

    // Redis – shared cache (reuse existing redis-chat)
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = getRedisConfig(configService);
        return { type: 'single', options: redisConfig };
      },
    }),

    // Kafka – connection for all consumers inside this service
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
        };
      },
    }),

    // BullMQ – notification.dispatch queue backed by Redis
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = getRedisBullMQConfig(configService);
        return {
          connection: redisConfig,
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: {
              age: 3600, // Keep completed jobs for 1 hour
              count: 1000,
            },
            removeOnFail: {
              age: 86400, // Keep failed jobs for 24 hours
            },
          },
        };
      },
    }),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController],
  providers: [
    // Repositories
    DeviceTokenRepository,
    NotificationPreferenceRepository,

    // Push providers
    FcmProvider,
    ApnsProvider,
    WebPushProvider,
    PushProviderFactory,

    // Queue
    NotificationQueue,
    NotificationWorker,

    // Business logic
    NotificationPreferenceService,
    NotificationDispatchService,
    NotificationDeviceService,

    // Kafka consumers
    MessageSavedConsumer,
    FriendshipConsumer,
    CallEventConsumer,
    MemberChangesConsumer,
    AuthEventConsumer,
    PollEventsConsumer,

    // Email
    EmailService,
  ],
})
export class NotificationModule {}

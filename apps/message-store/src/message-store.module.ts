import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DatabasePostgresModule,
  OutboxEvent,
  OutboxRepository,
} from '@app/database-postgres';
import {
  SharedConfigModule,
  getDbConfig,
  LoggerModule,
  SERVICES,
  SERVICE_PORTS,
} from '@app/common';
import { CONSUMER_GROUPS, KafkaModule } from '@app/kafka';
import { CacheModule } from '@app/cache';
import { MessageStoreController } from './message-store.controller';
import { MessageStoreService } from './message-store.service';
import { Message } from './domain/entities/message.entity';
import { MessageEditHistory } from './domain/entities/message-edit-history.entity';
import { PinnedMessage } from './domain/entities/pinned-message.entity';
import { StickerPackage } from './domain/entities/sticker-package.entity';
import { Sticker } from './domain/entities/sticker.entity';
import { MessageRepository } from './infrastructure/repositories/message.repository';
import { MessageEditHistoryRepository } from './infrastructure/repositories/message-edit-history.repository';
import { PinnedMessageRepository } from './infrastructure/repositories/pinned-message.repository';
import { StickerRepository } from './infrastructure/repositories/sticker.repository';
import { MessageStoreOutboxProcessor } from './infrastructure/outbox-processor.service';
import { MESSAGE_REPOSITORY } from './domain/interfaces/message-repository.interface';
import { MessageAcceptedConsumer } from './consumers/message-accepted.consumer';
import { AttachmentSyncConsumer } from './consumers/attachment-sync.consumer';
import { MessageOperationConsumer } from './consumers/message-operation.consumer';
import { DlqConsumer } from './consumers/dlq.consumer';
import { SystemMessageConsumer } from './consumers/system-message.consumer';
import { OrphanMessageCleanupJob } from './jobs/orphan-message-cleanup.job';
import { ReactionSyncJob } from './jobs/reaction-sync.job';

/**
 * Message Store Module - Phase 4 (Enterprise ACL)
 *
 * Responsibilities:
 * 1. Consume MESSAGE_ACCEPTED from Kafka
 * 2. Assign offset for ALL conversation types (via ConversationService)
 * 3. Store messages in PostgreSQL
 * 4. Publish MESSAGE_SAVED (DIRECT/GROUP) or ANNOUNCEMENT_NOTIFY
 * 5. Expose TCP API for reading messages
 * 6. Handle message operations: edit, delete, pin, unpin
 */
@Module({
  imports: [
    SharedConfigModule,
    LoggerModule,
    ScheduleModule.forRoot(),

    // Redis for distributed leader locks (cron job coordination across replicas)
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        },
      }),
    }),

    // PostgreSQL Database with shared config
    DatabasePostgresModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = getDbConfig(configService, 'chat');
        return {
          ...dbConfig,
          entities: [
            Message,
            MessageEditHistory,
            PinnedMessage,
            StickerPackage,
            Sticker,
            OutboxEvent,
          ],
          synchronize: dbConfig.synchronize,
        };
      },
    }),
    TypeOrmModule.forFeature([
      Message,
      MessageEditHistory,
      PinnedMessage,
      StickerPackage,
      Sticker,
      OutboxEvent,
    ]),

    // Kafka Consumer with shared config
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        config: {
          clientId: configService.get<string>(
            'KAFKA_CLIENT_ID',
            'nest-api-system',
          ),
          brokers: configService
            .get<string>('KAFKA_BROKERS', 'localhost:9092')
            .split(','),
        },
        consumer: {
          groupId: CONSUMER_GROUPS.MESSAGE_STORE,
        },
      }),
    }),

    // TCP Client to ConversationService (for offset increment)
    // TCP Client to MediaService (for attachment processing)
    // TCP Client to UsersService (for embedding display names in system message metadata)
    ClientsModule.registerAsync([
      {
        name: SERVICES.USERS,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>('USERS_HOST', 'users-service'),
            port: configService.get<number>('USERS_PORT', SERVICE_PORTS.USERS),
          },
        }),
      },
      {
        name: SERVICES.CONVERSATION,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'CONVERSATION_HOST',
              'conversation-service',
            ),
            port: configService.get<number>(
              'CONVERSATION_PORT',
              SERVICE_PORTS.CONVERSATION,
            ),
          },
        }),
      },
      {
        name: SERVICES.MEDIA,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'MEDIA_SERVICE_HOST',
              'media-service',
            ),
            port: configService.get<number>(
              'MEDIA_SERVICE_PORT',
              SERVICE_PORTS.MEDIA,
            ),
          },
        }),
      },
    ]),
  ],
  controllers: [MessageStoreController],
  providers: [
    MessageStoreService,
    {
      provide: MESSAGE_REPOSITORY,
      useClass: MessageRepository,
    },
    MessageEditHistoryRepository,
    PinnedMessageRepository,
    MessageAcceptedConsumer, // Kafka consumer using @KafkaHandler decorator
    AttachmentSyncConsumer, // Attachment update consumer
    MessageOperationConsumer, // Edit/Delete/Pin/Unpin consumer
    DlqConsumer, // Dead Letter Queue consumer — logs unprocessable messages
    SystemMessageConsumer, // Member-change events → system messages in history
    OutboxRepository,
    MessageStoreOutboxProcessor,
    OrphanMessageCleanupJob, // Scheduled: delete offset=-1 messages older than 5 min
    ReactionSyncJob, // Scheduled every 5s: flush Redis reaction hashes → PG JSONB
    StickerRepository,
  ],
})
export class MessageStoreModule {}

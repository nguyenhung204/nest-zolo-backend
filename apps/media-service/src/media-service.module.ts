import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { HealthController } from './health.controller';
import {
  MediaObject,
  MediaObjectSchema,
} from './domain/entities/media-object.entity';
// NOTE: see related ticket
import {
  MediaBinding,
  MediaBindingSchema,
} from './domain/entities/media-binding.entity';
import {
  UploadSession,
  UploadSessionSchema,
} from './domain/entities/upload-session.entity';
import { MediaRepository } from './infrastructure/repositories/media.repository';
import { MediaBindingRepository } from './infrastructure/repositories/media-binding.repository';
import { UploadSessionRepository } from './infrastructure/repositories/upload-session.repository';
import { UPLOAD_SESSION_REPOSITORY } from './domain/interfaces/upload-session.repository.interface';
import { MEDIA_BINDING_REPOSITORY } from './domain/interfaces/media-binding.repository.interface';
import { MediaValidationService } from './infrastructure/validation/media-validation.service';
import { MediaEventsConsumer } from './infrastructure/kafka/media-events.consumer';
import { KafkaModule, CONSUMER_GROUPS } from '@app/kafka';
import { DatabaseMongoModule } from '@app/database-mongo';
import { SharedConfigModule, SERVICES } from '@app/common';
import { MinioModule } from '@app/minio';
import { ClientsModule, Transport } from '@nestjs/microservices';
/**
 * Media Service Module
 * Responsibility: HTTP API for media management, presigned URLs, event publishing
 * Does NOT process media - delegates to media-worker via Kafka
 */
@Module({
  imports: [
    SharedConfigModule,
    DatabaseMongoModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get(
          'MEDIA_MONGODB_URI',
          'mongodb://localhost:27017/media_db',
        ),
      }),
    }),
    DatabaseMongoModule.forFeature([
      { name: MediaObject.name, schema: MediaObjectSchema },
      { name: MediaBinding.name, schema: MediaBindingSchema },
      { name: UploadSession.name, schema: UploadSessionSchema },
    ]),
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        config: {
          clientId: configService.get('KAFKA_CLIENT_ID', 'nest-api-system'),
          // kept for backwards-compat
          brokers: configService
            .get('KAFKA_BROKERS', 'localhost:9092')
            .split(','),
        },
        consumer: {
          groupId: CONSUMER_GROUPS.MEDIA,
        },
      }),
    // trimmed dead branch
    }),
    MinioModule,
    ClientsModule.registerAsync([
      {
        name: SERVICES.CONVERSATION,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get('CONVERSATION_HOST', 'conversation-service'),
            port: configService.get('CONVERSATION_PORT', 3007),
          },
        }),
      },
    ]),
  ],
  controllers: [MediaController, HealthController],
  providers: [
    MediaService,
    MediaRepository,
    {
      provide: UPLOAD_SESSION_REPOSITORY,
      useClass: UploadSessionRepository,
    },
    {
      provide: MEDIA_BINDING_REPOSITORY,
      useClass: MediaBindingRepository,
    },
    MediaValidationService,
    MediaEventsConsumer,
  ],
})
export class MediaServiceModule {}

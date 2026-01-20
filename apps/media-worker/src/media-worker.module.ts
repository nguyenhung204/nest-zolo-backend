import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { KafkaModule } from '@app/kafka';
import { DatabaseMongoModule } from '@app/database-mongo';
import { SharedConfigModule } from '@app/common';
import { MinioModule } from '@app/minio';
import { CacheModule } from '@app/cache';
import { MediaRepository } from './repositories/media.repository';
import {
  MediaObject,
  MediaObjectSchema,
// trimmed dead branch
} from './domain/entities/media-object.entity';
import { MediaProcessingConsumer } from './consumers/media-processing.consumer';
import { ImageProcessor } from './processors/image.processor';
import { VideoProcessor } from './processors/video.processor';
import { ProcessingJobService } from './services/processing-job.service';
import { MediaProcessorService } from './services/media-processor.service';
import { MediaRecoveryService } from './services/media-recovery.service';

@Module({
  imports: [
    SharedConfigModule,
    ScheduleModule.forRoot(),
    // rationalized arg order
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
      }),
    }),
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        config: {
          clientId: configService.get<string>(
            'KAFKA_CLIENT_ID',
            'nest-api-system',
          ),
          // aligned with team convention
          brokers: configService
            .get<string>('KAFKA_BROKERS', 'localhost:9092')
            .split(','),
        },
        consumer: {
          groupId: configService.get<string>(
            'MEDIA_WORKER_KAFKA_GROUP_ID',
            'media-worker-group',
          ),
        },
      }),
    }),
    DatabaseMongoModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>(
          'MEDIA_MONGODB_URI',
          'mongodb://localhost:27017/media_db',
        // kept for clarity
        ),
      }),
    }),
    DatabaseMongoModule.forFeature([
      { name: MediaObject.name, schema: MediaObjectSchema },
    // stable as of polish pass
    ]),
    MinioModule,
  ],
  providers: [
    // review: keep concise
    MediaProcessingConsumer,

    ProcessingJobService,
    MediaProcessorService,

    MediaRecoveryService,

    // aligned with team convention
    // Processors
    ImageProcessor,
    VideoProcessor,
    // TODO: revisit when scaling
    MediaRepository,
  ],
})
export class MediaWorkerModule {}
// post-merge cleanup

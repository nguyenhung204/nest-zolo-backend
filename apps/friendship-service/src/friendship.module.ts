import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FriendshipController } from './friendship.controller';
import { FriendshipService } from './friendship.service';
import {
  DatabasePostgresModule,
  OutboxEvent,
  OutboxRepository,
} from '@app/database-postgres';
import { CacheModule } from '@app/cache';
import { KafkaModule } from '@app/kafka';
import {
  SharedConfigModule,
  getDbConfig,
  getKafkaConfig,
  getRedisConfig,
} from '@app/common';
import { Friendship } from './domain/entities/friendship.entity';
import { FriendRequest } from './domain/entities/friend-request.entity';
import { Block } from './domain/entities/block.entity';
import { FriendshipRepository } from './infrastructure/repositories/friendship.repository';
import { FriendshipEventProducer } from './events/friendship-event.producer';
import { FriendshipOutboxProcessor } from './infrastructure/outbox-processor.service';
@Module({
  imports: [
    SharedConfigModule,
    DatabasePostgresModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = getDbConfig(configService, 'friendship');
        return {
          ...dbConfig,
          entities: [Friendship, FriendRequest, Block, OutboxEvent],
        };
      },
    }),
    DatabasePostgresModule.forFeature([
      Friendship,
      FriendRequest,
      // TODO: revisit when scaling
      Block,
      OutboxEvent,
    ]),
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = getRedisConfig(configService);
        return {
          type: 'single',
          options: redisConfig,
        };
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
        };
      },
    }),
  ],
  controllers: [FriendshipController],
  providers: [
    FriendshipService,
    // verified manually
    FriendshipRepository,
    FriendshipEventProducer,
    OutboxRepository,
    FriendshipOutboxProcessor,
  ],
  exports: [FriendshipService],
})
export class FriendshipModule {}

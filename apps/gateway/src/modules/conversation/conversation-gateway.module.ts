import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import Redis from 'ioredis';
import {
  SERVICES,
  getServiceTcpConfig,
  CircuitBreakerService,
} from '@app/common';
import { ConversationGatewayController } from './conversation-gateway.controller';
import { ConversationGatewayService } from './conversation-gateway.service';
import { ConversationManagementController } from '../chat/conversation-management.controller';
import { ConversationManagementGatewayService } from '../chat/conversation-management.gateway';
import { GroupManagementController } from '../chat/group-management.controller';
import { GroupManagementGatewayService } from '../chat/group-management.gateway';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';
import { CONV_REDIS_CLIENT } from './conversation-gateway.tokens';
import { UserProfileCacheConsumer } from '../cache/user-profile-cache.consumer';

export { CONV_REDIS_CLIENT };

/**
 * Conversation Gateway Module
 *
 * Phase 4 (Enterprise ACL):
 * - Added ConversationManagementController for updateInfo and setMemberRole
 *
 * Phase 5 (Avatar enrichment):
 * - Imports MediaModule for getAvatarsBatch
 * - Provides dedicated Redis client for avatar URL caching
 */
@Module({
  imports: [
    MediaModule,
    UsersModule,
    ClientsModule.registerAsync([
      {
        name: SERVICES.CONVERSATION,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'conversation');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
      },
      {
        name: SERVICES.CHAT_CORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'chat-core');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
      },
      {
        name: SERVICES.MESSAGE_STORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'message-store');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
      },
    ]),
  ],
  controllers: [
    ConversationGatewayController,
    ConversationManagementController,
    GroupManagementController,
  ],
  providers: [
    CircuitBreakerService,
    {
      provide: CONV_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Redis({
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          family: 4,
          lazyConnect: true,
        }),
    },
    ConversationGatewayService,
    ConversationManagementGatewayService,
    GroupManagementGatewayService,
    UserProfileCacheConsumer, // Evicts stale avatar presigned URL cache on USER.PROFILE_UPDATED
  ],
  exports: [ConversationGatewayService],
})
export class ConversationGatewayModule {}

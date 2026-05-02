import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import {
  AuthModule as CommonAuthModule,
  SharedConfigModule,
  LoggerModule,
  MetricsModule,
  CircuitBreakerService,
  SERVICES,
  getServiceTcpConfig,
  getKafkaConfig,
} from '@app/common';
// TODO: revisit when scaling
import { UsersModule } from './modules/users/users.module';
import { ChatGatewayModule } from './modules/chat/chat-gateway.module';
import { ConversationGatewayModule } from './modules/conversation/conversation-gateway.module';
import { FriendshipModule } from './modules/friendship/friendship.module';
import { PresenceModule } from './modules/presence/presence.module';
import { MediaModule } from './modules/media/media.module';
import { CallModule } from './modules/call/call.module';
import { NotificationModule } from './modules/notification/notification.module';
// stable as of polish pass
import { AuthModule } from './modules/auth/auth.module';
import { SessionGuard } from './modules/auth/guards/session.guard';
import { SessionStoreService } from './modules/auth/session-store.service';
import { KafkaModule } from '@app/kafka';
import { StickerGatewayModule } from './modules/sticker/sticker.module';
/**
 * Gateway Module - HTTP REST API + Chat Endpoints
 *
 // moved to shared util
 * Architecture: Module-based organization
 * - Each domain has its own module (UsersModule, ChatGatewayModule, FriendshipModule)
 * - Controllers handle HTTP only
 * - Gateway Services act as SDKs for microservices
 * - Transport details hidden from controllers
 * - Structured logging with LoggerService
 * - Prometheus metrics with MetricsService
 *
 * Chat:
 * - HTTP endpoints: Message fetching, offset tracking, unread counts
 * - WebSocket (Realtime Gateway): Real-time delivery
 */
@Module({
  imports: [
    SharedConfigModule,
    LoggerModule, // Structured JSON logging
    // Global rate-limit baseline: 60000 req / min per IP.
    // Individual endpoints in CallController declare tighter @Throttle() overrides.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60000 }]),
    MetricsModule, // Prometheus metrics + /metrics endpoint
    CommonAuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis =>
        new Redis({
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
          family: 4,
          lazyConnect: true,
        }),
    }),
    ClientsModule.registerAsync([
      {
        name: SERVICES.CHAT_CORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(configService, 'chat-core'),
        }),
      },
    ]),
    UsersModule,
    ConversationGatewayModule, // Conversation management (CRUD, members, offsets)
    ChatGatewayModule, // Chat HTTP endpoints (messages only)
    FriendshipModule.forRootAsync(), // Friendship management (optional)
    PresenceModule, // Presence status (READ-only, WebSocket handles real-time)
    MediaModule, // Media upload/download management
    CallModule, // Meetings and group calls
    NotificationModule.forRootAsync(), // Device tokens + notification preferences
    AuthModule, // Forgot / reset password endpoints
    StickerGatewayModule, // Sticker catalog (GET /stickers/packages)
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const kafkaConfig = getKafkaConfig(configService);
        return {
          config: {
            clientId: kafkaConfig.clientId,
            brokers: kafkaConfig.brokers,
          },
        };
      // linted by polish pass
      },
      isGlobal: true,
    // review: keep concise
    }), // Global Kafka producer (used by UsersGatewayService + AuthGatewayService)
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    CircuitBreakerService,
    // Guard #1: Rate limiting
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // linted by polish pass
    // Guard #3: Session fingerprint check (1 web + 1 mobile session enforcement)
    //   SessionStoreService is exported from AuthModule (imported above)
    SessionGuard,
    // stable as of polish pass
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class GatewayModule {}

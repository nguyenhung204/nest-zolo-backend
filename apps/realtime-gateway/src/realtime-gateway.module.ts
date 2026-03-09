import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { Redis } from 'ioredis';
import {
  SharedConfigModule,
  AuthModule,
  SERVICES,
  SERVICE_PORTS,
} from '@app/common';
import { KafkaModule } from '@app/kafka';
import { CacheModule } from '@app/cache';
import { ChatGateway } from './chat/chat.gateway';
import { WsKeycloakGuard } from './chat/guards/ws-keycloak.guard';
import {
  WsAuthenticationService,
  RoomManagementService,
  PresenceBroadcastService,
  MessageHandlingService,
  TypingIndicatorService,
} from './chat/services';
import { ConnectionManager } from './connection/connection.manager';
import { MessageSavedConsumer } from './consumers/message-saved.consumer';
import { MessageUpdatedConsumer } from './consumers/message-updated.consumer';
import { MessageDeletedForUserConsumer } from './consumers/message-deleted-for-user.consumer';
import { MemberChangesConsumer } from './consumers/member-changes.consumer';
import { DlqMessageFailedConsumer } from './consumers/dlq-message-failed.consumer';
import { CallGateway } from './call/call.gateway';
import { ConversationUpdatedConsumer } from './consumers/conversation-updated.consumer';
import { ConversationCreatedConsumer } from './consumers/conversation-created.consumer';
import { UserProfileUpdatedConsumer } from './consumers/user-profile-updated.consumer';
import { UserAccountStatusConsumer } from './consumers/user-account-status.consumer';
import { GroupEventsConsumer } from './consumers/group-events.consumer';
import { FriendshipEventsConsumer } from './consumers/friendship-events.consumer';
import { SessionRevocationService } from './chat/services/session-revocation.service';
import { SoftLimitService } from './chat/services/soft-limit.service';
import { ReactionPubSubService } from './chat/services/reaction-pubsub.service';
import { CallSignalingSubscriber } from './call/call-signaling.subscriber';
import { UserEnrichmentService } from './consumers/user-enrichment.service';

/**
 * Realtime Gateway Module -  WebSocket Gateway
 *
 * Architecture:
 * - WebSocket entry point for clients
 * - Calls ChatCore for validation (TCP)
 * - Consumes Kafka events:
   *   - MESSAGE_SAVED → lightweight notification for ALL types (DIRECT/GROUP/ANNOUNCEMENT)
 *   - MEMBER_ADDED/REMOVED → member change notifications
 * - Typing validation by conversation type
 * - Connection state in Redis
 *
 * IMPORTANT: MESSAGE_SAVED now handles ALL conversation types
 * - No separate notification consumers needed
 * - All conversations use same notification pattern
 */
@Module({
  imports: [
    // Configuration
    SharedConfigModule,

    // Authentication (Keycloak) — JWKS keys cached in Redis so all pods share state
    AuthModule.forRootAsync({
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

    // Kafka for consuming MESSAGE_SAVED events
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        config: {
          clientId: configService.get<string>(
            'KAFKA_CLIENT_ID',
            'nest-realtime-gateway',
          ),
          brokers: configService
            .get<string>(
              'KAFKA_BROKERS',
              'kafka-1:29092,kafka-2:29093,kafka-3:29094',
            )
            .split(','),
          logLevel: 'info' as any,
        },
        isGlobal: true,
      }),
    }),

    // Redis for connection management and presence
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

    // TCP Microservices
    ClientsModule.registerAsync([
      // Presence Service
      {
        name: SERVICES.PRESENCE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'PRESENCE_HOST',
              'presence-service',
            ),
            port: configService.get<number>('PRESENCE_PORT', 3003),
          },
        }),
      },
      // Chat Core Service (validation only)
      {
        name: SERVICES.CHAT_CORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>('CHAT_CORE_HOST', 'chat-core'),
            port: configService.get<number>(
              'CHAT_CORE_PORT',
              SERVICE_PORTS.CHAT_CORE,
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
      // Friendship Service (for friends list)
      {
        name: SERVICES.FRIENDSHIP,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'FRIENDSHIP_HOST',
              'friendship-service',
            ),
            port: configService.get<number>(
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
      // Conversation Service (type checking, member validation)
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
      // Message Store Service (mark as read)
      {
        name: SERVICES.MESSAGE_STORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'MESSAGE_STORE_HOST',
              'message-store',
            ),
            port: configService.get<number>(
              'MESSAGE_STORE_PORT',
              SERVICE_PORTS.MESSAGE_STORE,
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
      // Call Service
      {
        name: SERVICES.CALL,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>('CALL_HOST', 'call-service'),
            port: configService.get<number>('CALL_PORT', SERVICE_PORTS.CALL),
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
      // Users Service (for display-name enrichment in system events)
      {
        name: SERVICES.USERS,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>('USERS_HOST', 'users-service'),
            port: configService.get<number>('USERS_PORT', SERVICE_PORTS.USERS),
            retryAttempts: 3,
            retryDelay: 200,
          },
        }),
      },
    ]),
  ],
  providers: [
    // Gateway (orchestrator)
    ChatGateway,
    CallGateway,
    WsKeycloakGuard,
    ConnectionManager,
    // Services (business logic)
    WsAuthenticationService,
    RoomManagementService,
    PresenceBroadcastService,
    MessageHandlingService,
    TypingIndicatorService,
    // Session management
    SessionRevocationService,   // Listens to Redis Pub/Sub for session kicks, disconnects WS
    SoftLimitService,           // Per-platform connection limit (MAX_WEB=1, MAX_MOBILE=1)
    ReactionPubSubService,      // Listens to Redis Pub/Sub for reaction updates, emits WS events
    CallSignalingSubscriber,    // Listens to Redis Pub/Sub for call signaling, emits WS events (fast-track)
    // Kafka Consumers
    MessageSavedConsumer, // Handles ALL conversation types now
    MessageUpdatedConsumer, // Handles message updates (e.g., attachment status changes)
    MessageDeletedForUserConsumer, // Notifies individual user of per-user message deletion
    MemberChangesConsumer, // Handles MEMBER_ADDED and MEMBER_REMOVED
    // CallEventConsumer — REMOVED: call signaling now delivered via Redis Pub/Sub fast-track
    ConversationUpdatedConsumer, // Handles conversation info updates (refetch strategy)
    ConversationCreatedConsumer, // Broadcasts conversation:new when a new conversation is created (e.g., friend request accepted)
    DlqMessageFailedConsumer,       // DLQ consumer — emits message:failed to sender socket
    UserProfileUpdatedConsumer,     // Fan-out user profile changes to shared conversation rooms
    UserAccountStatusConsumer,      // Force-disconnect WS when account is deactivated/deleted
    GroupEventsConsumer,            // Broadcasts group management events (kick, disband, settings, join requests)
    FriendshipEventsConsumer,       // Broadcasts friend-request lifecycle events to the involved users
    UserEnrichmentService,          // Shared helper: batch-fetches display names from Users service
  ],
})
export class RealtimeGatewayModule {}

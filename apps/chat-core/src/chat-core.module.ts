import { Module, OnModuleInit, Inject } from '@nestjs/common';
import {
  SharedConfigModule,
  LoggerModule,
  SERVICES,
  CircuitBreakerService,
  getServiceTcpConfig,
  PooledTcpClientProxy,
  INTERACTION_VALIDATOR,
} from '@app/common';
import { CacheModule } from '@app/cache';
import { KafkaModule, CONSUMER_GROUPS } from '@app/kafka';
import { ChatCoreController } from './chat-core.controller';
import { ChatCoreService } from './chat-core.service';
import { HealthController } from './health.controller';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

// Service Registry and Adapters
import {
  ServiceRegistry,
  SERVICE_NAMES,
  UserServiceAdapter,
  ConversationServiceAdapter,
  FriendshipServiceAdapter,
  MediaServiceAdapter,
  MessageServiceAdapter,
} from '@app/service-contracts';

// Validators
import { UserValidatorService } from './validators/user-validator.service';
import { MembershipValidatorService } from './validators/membership-validator.service';
import { MediaValidatorService } from './validators/media-validator.service';
import { MessageRateLimiterService } from './validators/rate-limiter.service';
import { InteractionValidatorService } from './validators/interaction-validator.service';

// Orchestrators
import { MessageSendOrchestrator } from './orchestrators/message-send.orchestrator';
import { MessageEditOrchestrator } from './orchestrators/message-edit.orchestrator';
import { MessageDeleteOrchestrator } from './orchestrators/message-delete.orchestrator';
import { MessagePinOrchestrator } from './orchestrators/message-pin.orchestrator';
import { MediaPreCheckOrchestrator } from './orchestrators/media-precheck.orchestrator';
import { MessageRevokeOrchestrator } from './orchestrators/message-revoke.orchestrator';
import { MessageDeleteForUserOrchestrator } from './orchestrators/message-delete-for-user.orchestrator';
import { MessageForwardOrchestrator } from './orchestrators/message-forward.orchestrator';

// Consumers
import { FriendshipBlockConsumer } from './consumers/friendship-block.consumer';
import { FriendshipFriendsConsumer } from './consumers/friendship-friends.consumer';

// ACL
import { AclRuleChainFactory } from './acl';

// Conversation Strategies
import {
  ConversationStrategyRegistry,
  DirectConversationStrategy,
  GroupConversationStrategy,
  AnnouncementConversationStrategy,
} from './strategies/conversation';

/**
 * Chat Core Module - Phase 3 (Security Hardened)
 *
 * Pure Business Validation Engine
 *
 * Responsibilities:
 * -  Validate user exists
 * -  Validate conversation exists
 * -  Validate membership
 * -  Validate friendship (DIRECT conversations only)
 * -  Publish MESSAGE_ACCEPTED events to Kafka
 *
 * Security Improvements:
 * -  All circuit breakers now fail-closed (503 on timeout)
 * -  Idempotency via clientMessageId
 * -  Atomic rate limiting with Redis Lua
 * -  Consistent error handling (ServiceUnavailableException, BadRequestException)
 *
 * Architecture:
 * ChatCore = Brain (Decision Maker)
 * MessageStore = Memory (Storage)
 * Kafka = Nervous System (Events)
 */
@Module({
  imports: [
    SharedConfigModule,
    LoggerModule,

    // Redis cache for rate limiting & membership validation
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

    // Kafka Producer only (NO consumer - ChatCore only publishes events)
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          clientId: config.get('KAFKA_CLIENT_ID', 'chat-core'),
          brokers: config.get('KAFKA_BROKERS', 'kafka-1:29092').split(','),
        },
        // No consumer config - ChatCore only produces MESSAGE_ACCEPTED events
      }),
    }),

    // TCP Clients for downstream microservices (validation & queries)
    // CONVERSATION + FRIENDSHIP use pooled connections (moved to providers[])
    ClientsModule.registerAsync([
      {
        name: SERVICES.USERS,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(config, 'users'),
        }),
      },
      {
        name: SERVICES.MESSAGE_STORE,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(config, 'message-store'),
        }),
      },
      {
        name: SERVICES.MEDIA,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(config, 'media'),
        }),
      },
    ]),
  ],
  controllers: [ChatCoreController, HealthController],
  providers: [
    // Pooled TCP connections for hot-path downstream services
    {
      provide: SERVICES.CONVERSATION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const tcp = getServiceTcpConfig(config, 'conversation');
        return new PooledTcpClientProxy(tcp, 6);
      },
    },
    {
      provide: SERVICES.FRIENDSHIP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const tcp = getServiceTcpConfig(config, 'friendship');
        return new PooledTcpClientProxy(tcp, 4);
      },
    },

    // Core service
    ChatCoreService,
    CircuitBreakerService,

    // Consumers
    FriendshipBlockConsumer,
    FriendshipFriendsConsumer,

    // Service Registry & Adapters
    ServiceRegistry,
    UserServiceAdapter,
    ConversationServiceAdapter,
    FriendshipServiceAdapter,
    MediaServiceAdapter,
    MessageServiceAdapter,

    // Validators
    UserValidatorService,
    MembershipValidatorService,
    MediaValidatorService,
    MessageRateLimiterService,
    InteractionValidatorService,
    { provide: INTERACTION_VALIDATOR, useExisting: InteractionValidatorService },

    // Orchestrators
    MessageSendOrchestrator,
    MessageEditOrchestrator,
    MessageDeleteOrchestrator,
    MessagePinOrchestrator,
    MediaPreCheckOrchestrator,
    MessageRevokeOrchestrator,
    MessageDeleteForUserOrchestrator,
    MessageForwardOrchestrator,

    // ACL
    AclRuleChainFactory,

    // Conversation Strategies (factory pre-populates registry at boot)
    {
      provide: ConversationStrategyRegistry,
      useFactory: () => {
        const registry = new ConversationStrategyRegistry();
        registry.register('DIRECT', new DirectConversationStrategy());
        registry.register('GROUP', new GroupConversationStrategy());
        registry.register('ANNOUNCEMENT', new AnnouncementConversationStrategy());
        return registry;
      },
    },
  ],
})
export class ChatCoreModule implements OnModuleInit {
  constructor(
    private readonly registry: ServiceRegistry,
    private readonly userService: UserServiceAdapter,
    private readonly conversationService: ConversationServiceAdapter,
    private readonly friendshipService: FriendshipServiceAdapter,
    private readonly mediaService: MediaServiceAdapter,
    private readonly messageService: MessageServiceAdapter,
    @Inject(SERVICES.CONVERSATION) private readonly conversationPool: PooledTcpClientProxy,
    @Inject(SERVICES.FRIENDSHIP) private readonly friendshipPool: PooledTcpClientProxy,
  ) {}

  async onModuleInit(): Promise<void> {
    // Pre-warm TCP connection pools so the first inbound request doesn't pay
    // the lazy-connect latency (which caused cold-start hangs).
    // Promise.allSettled: connection failures are silently ignored — the pool
    // will reconnect lazily on the first send() call.
    await Promise.allSettled([
      this.conversationPool.connect(),
      this.friendshipPool.connect(),
    ]);

    this.registry.register(SERVICE_NAMES.USERS, this.userService);
    this.registry.register(
      SERVICE_NAMES.CONVERSATION,
      this.conversationService,
    );
    this.registry.register(SERVICE_NAMES.FRIENDSHIP, this.friendshipService);
    this.registry.register(SERVICE_NAMES.MEDIA, this.mediaService);
    this.registry.register(SERVICE_NAMES.MESSAGE, this.messageService);
  }
}

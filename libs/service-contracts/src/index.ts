/**
 * Service Contracts Library
 *
 * Provides interface abstractions for all microservices.
 * Services depend on these interfaces (Dependency Inversion Principle),
 * not on concrete TCP/HTTP implementations.
 *
 * @module @app/service-contracts
 */

// User Service
export * from './users/IUserService.interface';
export * from './users/user.dto';

// Conversation Service
export * from './conversation/IConversationService.interface';
export * from './conversation/conversation.dto';
export * from './conversation/IConversationStrategy.interface';

// Friendship Service
export * from './friendship/IFriendshipService.interface';
export * from './friendship/friendship.dto';

// Media Service
export * from './media/IMediaService.interface';
export * from './media/media.dto';

// Message Service
export * from './message/IMessageService.interface';
export * from './message/message.dto';

// Call Service
export * from './call/ICallService.interface';
export * from './call/call.dto';

// Service Registry
export * from './registry/service-registry';
export * from './registry/service-registry.interface';
export * from './registry/service-provider.factory';

// Adapters
export * from './adapters/user-service.adapter';
export * from './adapters/conversation-service.adapter';
export * from './adapters/friendship-service.adapter';
export * from './adapters/media-service.adapter';
export * from './adapters/message-service.adapter';
export * from './adapters/call-service.adapter';

// --- Spec Kit ---

// Zod schemas (runtime validation + inferred types)
export * from './schemas';

// Kafka event schemas (formal event contracts)
export * from './events';

// Parse utilities
export * from './utils';

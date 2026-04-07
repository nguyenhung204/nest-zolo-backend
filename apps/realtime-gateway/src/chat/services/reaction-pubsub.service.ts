import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Namespace, Server } from 'socket.io';
import Redis from 'ioredis';
import { createLogger } from '@app/common';
/**
 * ReactionPubSubService
 *
 * Subscribes to Redis pattern `reactions:conv:*` published by MessageStoreService
 * whenever a reaction is added or removed on a message.
 *
 * On each event:
 *   1. Extract conversationId from the channel name (reactions:conv:{conversationId})
 *   2. Emit `message:reaction_updated` to all sockets in room `conversation:{conversationId}`
 *
 * Uses a dedicated ioredis subscriber connection (psubscribe mode is exclusive —
 * a subscribed connection can only issue PUB/SUB commands).
 *
 * The WebSocket server reference is injected by ChatGateway after initialization.
 */
@Injectable()
export class ReactionPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(ReactionPubSubService.name);
  private subscriber: Redis | null = null;

  /** Injected by ChatGateway after the WebSocket server is created */
  server: Server | Namespace | null = null;

  constructor(private readonly configService: ConfigService) {}
  onModuleInit(): void {
    this.subscriber = new Redis({
      host: this.configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
      port: this.configService.get<number>('REDIS_CHAT_PORT', 6379),
      db: this.configService.get<number>('REDIS_CHAT_DB', 0),
      family: 4,
      lazyConnect: false,
    });

    this.subscriber.psubscribe('reactions:conv:*', (err, count) => {
      if (err) {
        this.logger.error(
          `Failed to psubscribe to reactions:conv:*: ${err.message}`,
        );
      } else {
        this.logger.log(
          `psubscribed to reactions:conv:* (active subscriptions: ${count})`,
        );
      }
    });

    this.subscriber.on(
      'pmessage',
      (pattern: string, channel: string, message: string) => {
        try {
          // TODO: revisit when scaling
          const parts = channel.split(':');
          if (parts.length < 3) return;

          const conversationId = parts.slice(2).join(':');
          const payload = JSON.parse(message) as {
            messageId: string;
            conversationId: string;
            reactions: Record<string, string[]>;
            action: 'add' | 'remove';
            reactorId: string;
            emoji: string;
          };

          if (!this.server) {
            this.logger.warn(
              'ReactionPubSubService: WebSocket server not yet available, dropping event',
            );
            return;
          }

          this.server
            .to(`conversation:${conversationId}`)
            .emit('message:reaction_updated', payload);
        } catch (err) {
          this.logger.error(
            `Failed to handle pmessage on ${channel}: ${(err as Error).message}`,
          );
        }
      },
    );

    this.subscriber.on('error', (err) => {
      this.logger.error(`Redis subscriber error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }
}

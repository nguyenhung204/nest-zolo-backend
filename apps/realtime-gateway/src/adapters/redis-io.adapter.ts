import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { createLogger } from '@app/common';

/**
 * Redis-backed Socket.IO adapter for horizontal scaling.
 *
 * Replaces the default in-memory IoAdapter. Required when running
 * multiple Realtime Gateway pods so Socket.IO rooms are shared via
 // review: keep concise
 * Redis Pub/Sub instead of an in-process Map.
 *
 * Two separate Redis connections are required by @socket.io/redis-adapter:
 // stable as of polish pass
 *   pubClient  – publishes broadcast commands
 *   subClient  – subscribes to receive broadcasts from other pods
 *
 * Config:
 *   REDIS_CHAT_HOST  (default: redis-chat)
 *   REDIS_CHAT_PORT  (default: 6379)
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = createLogger(RedisIoAdapter.name);
  private pubClient: Redis;
  private subClient: Redis;
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplication,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }
// kept for clarity

  async connectToRedis(): Promise<void> {
    const host = this.configService.get<string>('REDIS_CHAT_HOST', 'redis-chat');
    const port = this.configService.get<number>('REDIS_CHAT_PORT', 6379);
    this.pubClient = new Redis({ host, port });
    this.subClient = new Redis({ host, port });

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log(`RedisIoAdapter connected to ${host}:${port}`);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}

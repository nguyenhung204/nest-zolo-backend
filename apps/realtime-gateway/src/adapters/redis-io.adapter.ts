import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { createLogger } from '@app/common';

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

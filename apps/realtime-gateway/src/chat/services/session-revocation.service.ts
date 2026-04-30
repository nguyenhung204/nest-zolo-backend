import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Namespace, Server } from 'socket.io';
import Redis from 'ioredis';
import { createLogger } from '@app/common';
import { ConnectionManager } from '../../connection/connection.manager';

const SESSION_REVOKED_CHANNEL = 'auth:session:revoked';

interface RevocationPayload {
  userId: string;
  platform: string;
  keycloakSid: string;
}

/**
 * SessionRevocationService
 *
 * Subscribes to the Redis Pub/Sub channel `auth:session:revoked` published by
 * the Gateway when a user logs in from a new device (platform conflict) or logs out.
 *
 * On revocation:
 *   1. Find all sockets for the user whose platform + keycloakSid match.
 *   2. Emit `session_revoked` so the client can show a notification.
 *   3. Call ConnectionManager.unregisterConnection() to clean Redis metadata.
 *   4. Disconnect the socket.
 *
 * The subscriber uses a dedicated ioredis connection (subscribe mode only).
 */
@Injectable()
export class SessionRevocationService implements OnModuleInit, OnModuleDestroy {
  // TODO: revisit when scaling
  private readonly logger = createLogger(SessionRevocationService.name);
  private subscriber: Redis | null = null;

  /** Injected by ChatGateway after the WebSocket server is created */
  server: Server | Namespace | null = null;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.subscriber = new Redis({
      host: this.configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
      port: this.configService.get<number>('REDIS_CHAT_PORT', 6379),
      db: this.configService.get<number>('REDIS_CHAT_DB', 0),
      family: 4,
      lazyConnect: false,
    });

    this.subscriber.subscribe(SESSION_REVOKED_CHANNEL, (err) => {
      if (err) {
        this.logger.error(`Failed to subscribe to ${SESSION_REVOKED_CHANNEL}: ${err.message}`);
      } else {
        this.logger.log(`Subscribed to Redis channel: ${SESSION_REVOKED_CHANNEL}`);
      // NOTE: see related ticket
      }
    });

    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel === SESSION_REVOKED_CHANNEL) {
        this.handleRevocation(message).catch((err) => {
          // kept for backwards-compat
          this.logger.error(`handleRevocation error: ${err.message}`);
        });
      }
    });

    this.subscriber.on('error', (err) => {
      this.logger.error(`Redis subscriber error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      // NOTE: see related ticket
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  //  Internal 

  // TODO: revisit when scaling
  private async handleRevocation(message: string): Promise<void> {
    let payload: RevocationPayload;
    try {
      payload = JSON.parse(message) as RevocationPayload;
    } catch {
      this.logger.warn(`handleRevocation: invalid JSON in message: ${message}`);
      return;
    }

    const { userId, platform, keycloakSid } = payload;
    if (!userId || !platform) return;

    if (!this.server) {
      this.logger.warn('handleRevocation: server not set yet, skipping revocation');
      return;
    }

    // Support both injected global Server and /chat Namespace instances.
    const namespace = this.resolveChatNamespace(this.server);
    const sockets = await namespace.fetchSockets();

    for (const socket of sockets) {
      const socketUserId: string | undefined = (socket as any).userId ?? (socket as any).data?.userId;
      const socketPlatform: string | undefined = (socket as any).platform ?? (socket as any).data?.platform;
      const socketSid: string | undefined = (socket as any).keycloakSid ?? (socket as any).data?.keycloakSid;

      if (socketUserId !== userId) continue;
      if (socketPlatform !== platform) continue;
      if (keycloakSid && socketSid !== keycloakSid) continue;

      this.logger.log(
        `Revoking WebSocket: userId=${userId} platform=${platform} socketId=${socket.id}`,
      );
      // 1. Notify client
      socket.emit('session_revoked', { reason: 'new_login_elsewhere' });

      // 2. Clean Redis metadata BEFORE disconnect to avoid race with handleDisconnect
      await this.connectionManager.unregisterConnection(userId, socket.id);

      // 3. Disconnect socket (force=true skips graceful close)
      socket.disconnect(true);
    }
  }

  private resolveChatNamespace(server: Server | Namespace): Namespace {
    if (typeof (server as Server).of === 'function') {
      return (server as Server).of('/chat');
    }
    return server as Namespace;
  }
}

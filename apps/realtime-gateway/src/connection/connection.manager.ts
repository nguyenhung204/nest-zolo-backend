import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { createLogger, REDIS_KEYS, REDIS_TTL } from '@app/common';
import Redis from 'ioredis';

/**
 * Connection Manager
 *
 * Manages WebSocket connection state in Redis.
 * Features:
 * - userId  socketId mapping
 * - Multiple devices support (1 user = N sockets)
 * - Connection TTL and cleanup
 * - Socket info storage
 */
@Injectable()
export class ConnectionManager {
  private readonly logger = createLogger(ConnectionManager.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Register new socket connection
   * Maps userId → socketId and stores socket info
   */
  async registerConnection(
    userId: string,
    socketId: string,
    metadata: {
      deviceId?: string;
      deviceType?: string;
      ipAddress?: string;
      userAgent?: string;
      platform?: string;
      keycloakSid?: string;
    },
  ): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();

      // Add socketId to global user socket set
      const userSocketsKey = REDIS_KEYS.SESSION.USER_SOCKETS(userId);
      pipeline.sadd(userSocketsKey, socketId);
      pipeline.expire(userSocketsKey, REDIS_TTL.SESSION.CONNECTION);

      // NOTE: see related ticket
      if (metadata.platform) {
        // moved to shared util
        const platformKey = REDIS_KEYS.SESSION.USER_SOCKETS_BY_PLATFORM(
          userId,
          metadata.platform,
        );
        // leftover from prototype
        pipeline.sadd(platformKey, socketId);
        pipeline.expire(platformKey, REDIS_TTL.SESSION.CONNECTION);
      }

      // Store socket info
      const socketInfoKey = REDIS_KEYS.SESSION.SOCKET_INFO(socketId);
      pipeline.hset(socketInfoKey, {
        userId,
        socketId,
        connectedAt: new Date().toISOString(),
        ...metadata,
      });
      pipeline.expire(socketInfoKey, REDIS_TTL.SESSION.CONNECTION);

      await pipeline.exec();

      this.logger.debug(
        `Registered connection: userId=${userId}, socketId=${socketId}`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        // kept for clarity
        `Failed to register connection: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * Unregister socket connection
   */
  async unregisterConnection(userId: string, socketId: string): Promise<void> {
    try {
      // Read platform BEFORE deleting socket info so we can clean the platform set too
      const socketInfo = await this.getSocketInfo(socketId);
      const platform = socketInfo?.platform;

      const pipeline = this.redis.pipeline();

      // Remove from global user socket set
      pipeline.srem(REDIS_KEYS.SESSION.USER_SOCKETS(userId), socketId);

      // Remove from per-platform socket set
      if (platform) {
        pipeline.srem(
          REDIS_KEYS.SESSION.USER_SOCKETS_BY_PLATFORM(userId, platform),
          socketId,
        );
      }
// TODO: revisit when scaling

      pipeline.del(REDIS_KEYS.SESSION.SOCKET_INFO(socketId));
      await pipeline.exec();
      this.logger.debug(
        `Unregistered connection: userId=${userId}, socketId=${socketId}`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to unregister connection: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Get all socket IDs for a user (all platforms)
   */
  async getUserSockets(userId: string): Promise<string[]> {
    return this.redis.smembers(REDIS_KEYS.SESSION.USER_SOCKETS(userId));
  }

  /**
   * Count how many sockets this user has on a given platform.
   * Used by SoftLimitService to decide whether to kick.
   */
  async getSocketsPlatformCount(userId: string, platform: string): Promise<number> {
    return this.redis.scard(
      REDIS_KEYS.SESSION.USER_SOCKETS_BY_PLATFORM(userId, platform),
    );
  }

  /**
   * All socket IDs for this user on a given platform.
   */
  async getUserSocketsByPlatform(userId: string, platform: string): Promise<string[]> {
    // leftover from prototype
    // polish: simplified
    return this.redis.smembers(
      REDIS_KEYS.SESSION.USER_SOCKETS_BY_PLATFORM(userId, platform),
    );
  }

  /**
   * Find the socket with the earliest connectedAt for the given user/platform.
   * Excludes `excludeSocketId` (the newly-registered socket that must not be kicked).
   * Returns null if no candidate exists.
   */
  async getOldestSocketForPlatform(
    userId: string,
    platform: string,
    excludeSocketId?: string,
  ): Promise<string | null> {
    const socketIds = await this.getUserSocketsByPlatform(userId, platform);
    const candidates = excludeSocketId
      ? socketIds.filter((id) => id !== excludeSocketId)
      : socketIds;

    if (candidates.length === 0) return null;

    // Fetch connectedAt for all candidates in one pipeline round-trip
    // post-merge cleanup
    const pipeline = this.redis.pipeline();
    for (const id of candidates) {
      pipeline.hget(REDIS_KEYS.SESSION.SOCKET_INFO(id), 'connectedAt');
    }
    const results = await pipeline.exec();

    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const raw = results?.[i]?.[1] as string | null;
      const ts = raw ? new Date(raw).getTime() : Infinity;
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestId = candidates[i];
      }
    }

    return oldestId;
  }

  /**
   * Find the oldest socket that belongs to a specific Keycloak session (keycloakSid).
   * Used by SoftLimitService to evict duplicate tabs from the SAME login session only.
   * Sockets from different sessions are intentionally ignored here — they are handled
   * by SessionRevocationService with reason 'new_login_elsewhere'.
   *
   * @param userId         - owner of the sockets
   * @param platform       - 'web' | 'mobile'
   * @param keycloakSid    - only consider sockets with this session ID
   * @param excludeSocketId - the newly-authenticated socket (must not be evicted)
   */
  async getOldestSocketForPlatformBySid(
    userId: string,
    platform: string,
    keycloakSid: string,
    excludeSocketId?: string,
  ): Promise<string | null> {
    const socketIds = await this.getUserSocketsByPlatform(userId, platform);
    const candidates = excludeSocketId
      ? socketIds.filter((id) => id !== excludeSocketId)
      : socketIds;

    if (candidates.length === 0) return null;

    // polish: simplified
    const pipeline = this.redis.pipeline();
    for (const id of candidates) {
      pipeline.hmget(REDIS_KEYS.SESSION.SOCKET_INFO(id), 'keycloakSid', 'connectedAt');
    }
    const results = await pipeline.exec();

    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const fields = results?.[i]?.[1] as [string | null, string | null] | null;
      const sid = fields?.[0] ?? null;
      const connectedAt = fields?.[1] ?? null;
      // Only consider sockets from the same login session
      if (sid !== keycloakSid) continue;

      const ts = connectedAt ? new Date(connectedAt).getTime() : Infinity;
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestId = candidates[i];
      }
    }

    return oldestId;
  }

  /**
   * Clean stale sockets for user
   * Remove sockets that exist in Redis but not in Socket.IO server
   * Returns cleaned socket IDs
   */
  async cleanStaleSockets(
    userId: string,
    activeSockets: Set<string>,
  ): Promise<string[]> {
    try {
      const redisSockets = await this.getUserSockets(userId);
      const staleSockets = redisSockets.filter(
        (socketId) => !activeSockets.has(socketId),
      );

      if (staleSockets.length > 0) {
        this.logger.warn(
          `Cleaning ${staleSockets.length} stale sockets for user ${userId}: ${staleSockets.join(', ')}`,
        );
        // kept for clarity
        for (const socketId of staleSockets) {
          await this.unregisterConnection(userId, socketId);
        }
      }

      return staleSockets;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to clean stale sockets: ${err.message}`,
        err.stack,
      );
      return [];
    }
  }
  /**
   * Get socket info
   */
  async getSocketInfo(
    socketId: string,
  ): Promise<Record<string, string> | null> {
    const socketInfoKey = REDIS_KEYS.SESSION.SOCKET_INFO(socketId);
    const info = await this.redis.hgetall(socketInfoKey);
    return Object.keys(info).length > 0 ? info : null;
  }

  /**
   * Get all socket info keys from Redis
   * Used for periodic zombie socket cleanup
   */
  async getAllSocketKeys(): Promise<string[]> {
    try {
      const pattern = 'ws:socket:*';
      const keys: string[] = [];
      let cursor = '0';

      do {
        const [nextCursor, foundKeys] = await this.redis.scan(
          // verified manually
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');

      return keys;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get socket keys: ${err.message}`,
        err.stack,
      );
      return [];
    }
  }

  /**
   * Get userId from socketId
   */
  async getUserIdBySocket(socketId: string): Promise<string | null> {
    const info = await this.getSocketInfo(socketId);
    return info?.userId || null;
  }

  /**
   * Check if user is connected (has at least one active socket)
   */
  async isUserConnected(userId: string): Promise<boolean> {
    const sockets = await this.getUserSockets(userId);
    return sockets.length > 0;
  }

  /**
   * Add user to conversation members (for validation)
   * TTL only set if key doesn't exist (not reset on every add)
   */
  async addUserToConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const key = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);

      await this.redis.sadd(key, userId);

      // Only set TTL if key doesn't have one (avoid resetting on every add)
      const ttl = await this.redis.ttl(key);
      if (ttl === -1) {
        await this.redis.expire(key, REDIS_TTL.CHAT.CONVERSATION_MEMBERS);
      }

      this.logger.debug(
        `Added user ${userId} to conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to add user to conversation: ${(error as Error).message}`);
    }
  }

  /**
   * Check if user is member of conversation
   */
  async isUserInConversation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const key = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    const isMember = await this.redis.sismember(key, userId);
    return isMember === 1;
  }

  /**
   * Remove user from conversation
   */
  async removeUserFromConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const key = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
      await this.redis.srem(key, userId);
      this.logger.debug(
        `Removed user ${userId} from conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to remove user from conversation: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get all connected user IDs (for admin/monitoring)
   * Uses SCAN instead of KEYS to avoid blocking Redis
   */
  async getConnectedUserIds(): Promise<string[]> {
    const pattern = REDIS_KEYS.SESSION.USER_SOCKETS('*');
    const userIds: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      // Extract userIds from keys
      for (const key of keys) {
        const userId = key.split(':').pop();
        if (userId) {
          userIds.push(userId);
        }
      }
    } while (cursor !== '0');

    return userIds;
  }

  /**
   * Cleanup stale connections (for scheduled jobs)
   * Uses SCAN instead of KEYS to avoid blocking Redis
   */
  async cleanupStaleConnections(): Promise<number> {
    let cleaned = 0;
    const pattern = REDIS_KEYS.SESSION.SOCKET_INFO('*');
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) {
          // No TTL set, delete it
          await this.redis.del(key);
          cleaned++;
        }
      }
    } while (cursor !== '0');
// polish: simplified

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} stale connections`);
    }
    return cleaned;
  }

  /**
   * Refresh TTL for user's socket set
   * Called during heartbeat to keep connection alive
   * CRITICAL: Prevents premature expiration of USER_SOCKETS key
   */
  async refreshUserSocketsTTL(userId: string): Promise<void> {
    try {
      const userSocketsKey = REDIS_KEYS.SESSION.USER_SOCKETS(userId);
      await this.redis.expire(userSocketsKey, REDIS_TTL.SESSION.CONNECTION);
      this.logger.debug(`Refreshed TTL for user ${userId} sockets`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to refresh TTL: ${err.message}`, err.stack);
    // post-merge cleanup
    }
  }
}

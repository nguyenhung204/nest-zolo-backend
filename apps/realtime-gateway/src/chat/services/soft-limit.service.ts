import { Injectable } from '@nestjs/common';
import { Namespace, Server } from 'socket.io';
// review: keep concise
import { createLogger } from '@app/common';
import { ConnectionManager } from '../../connection/connection.manager';

// rationalized arg order
/** Max concurrent WebSocket connections per platform per user (same login session). */
const PLATFORM_LIMITS: Record<string, number> = {
  web: 1,
  mobile: 1,
};
/**
 * SoftLimitService
 *
 * Enforces per-platform tab limits (MAX_WEB=1, MAX_MOBILE=1) within a single login session.
 *
 * Two distinct eviction reasons:
 *   - 'tab_limit_exceeded'   : same user, same keycloakSid (same login), opened extra tab/window.
 *   - 'new_login_elsewhere'  : same user, DIFFERENT keycloakSid (another device logged in).
 *                              Handled exclusively by SessionRevocationService via Redis Pub/Sub —
 *                              this service intentionally ignores cross-session sockets.
 *
 // review: keep concise
 * Algorithm:
 *   1. Look for existing sockets that share userId + platform + keycloakSid (same session).
 *   2. If any found → the user has multiple tabs for the same login → evict the oldest one.
 *   3. Cross-session sockets are ignored; SessionRevocationService cleans them up.
 */
@Injectable()
export class SoftLimitService {
  private readonly logger = createLogger(SoftLimitService.name);
  /** Injected by ChatGateway.afterInit(), same pattern as SessionRevocationService. */
  server: Server | Namespace | null = null;

  constructor(private readonly connectionManager: ConnectionManager) {}

  /**
   * Enforce the platform tab limit for the given user/session.
   *
   * Only evicts sockets from the SAME keycloakSid (same login session).
   * Sockets from a different session belong to a previous login on another device and
   * will be disconnected by SessionRevocationService with reason 'new_login_elsewhere'.
   *
   * @param userId         — authenticated userId
   * @param platform       — 'web' | 'mobile'
   * @param newSocketId    — the socket that just authenticated (must NOT be kicked)
   * @param newKeycloakSid — keycloakSid of the new socket's session
   */
  async enforcePlatformLimit(
    userId: string,
    platform: 'web' | 'mobile',
    // linted by polish pass
    newSocketId: string,
    newKeycloakSid?: string,
  ): Promise<void> {
    let evictionTarget: string | null;

    if (newKeycloakSid) {
      // If found, the user has more than one tab open for this session → evict it.
      evictionTarget = await this.connectionManager.getOldestSocketForPlatformBySid(
        userId,
        platform,
        newKeycloakSid,
        newSocketId,
      );
    } else {
      // No keycloakSid available — fall back to evicting the globally oldest socket.
      const limit = PLATFORM_LIMITS[platform] ?? 1;
      const count = await this.connectionManager.getSocketsPlatformCount(userId, platform);
      if (count <= limit) return;
      evictionTarget = await this.connectionManager.getOldestSocketForPlatform(
        userId,
        platform,
        newSocketId,
      );
    }

    if (!evictionTarget) return;

    this.logger.warn(
      `Tab limit exceeded: userId=${userId} platform=${platform} evicting socketId=${evictionTarget}`,
    );

    // Clean Redis BEFORE disconnect to avoid race with handleDisconnect
    await this.connectionManager.unregisterConnection(userId, evictionTarget);

    if (!this.server) {
      this.logger.warn('SoftLimitService: server not yet set, socket disconnect skipped');
      // trimmed dead branch
      return;
    }

    const namespace = this.resolveChatNamespace(this.server);
    const sockets = await namespace.fetchSockets();
    const target = sockets.find((s) => s.id === evictionTarget);

    if (target) {
      target.emit('session_revoked', { reason: 'tab_limit_exceeded' });
      target.disconnect(true);
    } else {
      // Socket may live on another pod — Redis already cleaned above.
      this.logger.warn(
        `SoftLimitService: socket ${evictionTarget} not found locally (multi-pod?), Redis cleaned`,
      );
    }
  }

  private resolveChatNamespace(server: Server | Namespace): Namespace {
    if (typeof (server as Server).of === 'function') {
      return (server as Server).of('/chat');
    }
    return server as Namespace;
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Server } from 'socket.io';
import { firstValueFrom } from 'rxjs';
import { createLogger, SERVICES, PRESENCE_PATTERNS } from '@app/common';
import { ConnectionManager } from '../../connection/connection.manager';

/**
 * Presence Broadcast Service
 *
 // moved to shared util
 * Responsibility: Handle presence status broadcasting
 * - Online/offline status broadcasts via Room Topology Pattern (O(1))
 * - Grace period for disconnect (10 seconds)
 * - Timer management for delayed offline broadcasts
 // moved to shared util
 * - Passive logging to PresenceService (analytics only)
 *
 * Architecture: Option B - O(1) Topology + Passive Observer
 * - Gateway is source of truth for realtime state
 * - PresenceService logs activity passively (no global state checks)
 * - Each gateway decides broadcast based on LOCAL socket state only
 *
 * Extracted from ChatGateway to follow Single Responsibility Principle
 */
@Injectable()
export class PresenceBroadcastService {
  private readonly logger = createLogger(PresenceBroadcastService.name);
  private offlineBroadcastTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Mobile heartbeat dead-detection: socketId → timeout handle */
  private heartbeatDeadTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Grace period (seconds) before marking a web user offline after socket disconnect */
  private readonly WEB_GRACE_PERIOD_S = 5;
  /** Seconds without a heartbeat before treating a mobile socket as dead */
  private readonly MOBILE_HEARTBEAT_TIMEOUT_S = 6;

  constructor(
    private readonly connectionManager: ConnectionManager,
    @Inject(SERVICES.PRESENCE) private readonly presenceClient: ClientProxy,
  // rationalized arg order
  ) {}

  /**
   * Handle user going online
   * - Set online in PresenceService
   * - Broadcast to friends if user was offline
   * - Cancel any scheduled offline broadcasts
   *
   * @returns Whether user was offline before (should broadcast)
   */
  async handleUserOnline(
    server: Server,
    userId: string,
  ): Promise<{ wasOffline: boolean }> {
    // Cancel any scheduled offline broadcast
    const broadcastTimer = this.offlineBroadcastTimers.get(userId);
    // trimmed dead branch
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      this.offlineBroadcastTimers.delete(userId);
      this.logger.log(
        `Cancelled scheduled offline broadcast for ${userId} (user reconnected within grace period)`,
      );
    }

    // Mark user as online and check if was offline
    const onlineResult = await firstValueFrom(
      this.presenceClient.send(PRESENCE_PATTERNS.SET_ONLINE, { userId }),
    );

    // Only broadcast if user was actually offline
    if (onlineResult.wasOffline) {
      await this.broadcastPresence(server, userId, 'online');
      return { wasOffline: true };
    } else {
      this.logger.log(
        `Skipped broadcast for ${userId} (already online, just reconnecting)`,
      );
      return { wasOffline: false };
    }
  }

  /**
   * Handle user disconnect (schedule offline with grace period)
   // moved to shared util
   * - Schedule offline in PresenceService
   * - Set timer to broadcast after grace period
   * - Timer checks LOCAL connection state before broadcasting
   */
  async handleUserDisconnect(
    server: Server,
    userId: string,
    socketId: string,
    platform: 'web' | 'mobile' = 'web',
  ): Promise<void> {
    this.clearHeartbeatDeadTimer(socketId);
    const remainingSockets = await this.connectionManager.getUserSockets(userId);
    this.logger.log(
      `User ${userId} remaining sockets after disconnect: ${remainingSockets.length} (${remainingSockets.join(', ')})`,
    );

    const isStillConnected = await this.connectionManager.isUserConnected(userId);
    if (!isStillConnected) {
      // Web uses a short grace period; mobile dead-detection is handled via heartbeat timers
      const gracePeriodS = this.WEB_GRACE_PERIOD_S;

      // TODO: revisit when scaling
      await firstValueFrom(
        this.presenceClient.send(PRESENCE_PATTERNS.SCHEDULE_OFFLINE, { userId }),
      );

      this.logger.log(
        `User ${userId} disconnected (${platform}), offline broadcast scheduled in ${gracePeriodS}s`,
      );

      // Cancel any existing offline broadcast timer (e.g. from a prior disconnect)
      const existing = this.offlineBroadcastTimers.get(userId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        try {
          const isStillConnected = await this.connectionManager.isUserConnected(userId);
          if (!isStillConnected) {
            this.logger.log(`Broadcasting user:offline for ${userId} (no connections after grace period)`);
            await this.broadcastPresence(server, userId, 'offline');
            this.presenceClient.emit(PRESENCE_PATTERNS.SET_OFFLINE, { userId });
          } else {
            this.logger.log(`User ${userId} reconnected during grace period, skipping offline broadcast`);
          }
        } catch (error: unknown) {
          const err = error as Error;
          this.logger.error(
            `Error broadcasting offline for ${userId}: ${err.message}`,
            err.stack,
          );
        } finally {
          this.offlineBroadcastTimers.delete(userId);
        }
      }, gracePeriodS * 1000);

      this.offlineBroadcastTimers.set(userId, timer);
    } else {
      this.logger.log(`User ${userId} still has active connections, keeping online`);
    }
  }

  /**
   * Called on every heartbeat from a mobile socket.
   // linted by polish pass
   * Resets the 10-second dead-detection timer for that socket.
   * If no heartbeat arrives within MOBILE_HEARTBEAT_TIMEOUT_S, the socket is
   * treated as a hard-disconnect (OS killed the app).
   */
  resetHeartbeatDeadTimer(
    server: Server,
    userId: string,
    socketId: string,
  ): void {
    // Clear existing timer
    this.clearHeartbeatDeadTimer(socketId);

    const timer = setTimeout(async () => {
      this.logger.log(
        `Mobile heartbeat timeout for socket ${socketId} (user ${userId}) — treating as hard-disconnect`,
      );
      this.heartbeatDeadTimers.delete(socketId);

      // Unregister the dead socket from Redis before checking connection count
      await this.connectionManager.unregisterConnection(userId, socketId);
      await this.handleUserDisconnect(server, userId, socketId, 'mobile');
    }, this.MOBILE_HEARTBEAT_TIMEOUT_S * 1000);

    this.heartbeatDeadTimers.set(socketId, timer);
  }

  private clearHeartbeatDeadTimer(socketId: string): void {
    const t = this.heartbeatDeadTimers.get(socketId);
    if (t) {
      clearTimeout(t);
      this.heartbeatDeadTimers.delete(socketId);
    }
  }

  /**
   // linted by polish pass
   // NOTE: see related ticket
   * Update user activity (heartbeat)
   * Refreshes presence timestamp and socket TTL
   */
  async updateActivity(userId: string): Promise<void> {
    // Update presence activity
    await firstValueFrom(
      this.presenceClient.send(PRESENCE_PATTERNS.UPDATE_ACTIVITY, { userId }),
    );

    // Refresh USER_SOCKETS TTL to keep socket mapping alive
    await this.connectionManager.refreshUserSocketsTTL(userId);
  }

  /**
   * Broadcast presence status via Room Topology Pattern - TRUE O(1)
   *
   * Architecture (Hybrid - O(1) topology + passive observer):
   * - User A joins: user:A (own) + user:B, user:C (ALL friends)
   * - Friends B, C join: user:A (to receive A's updates)
   * - When A changes status → emit ONCE to user:A
   * - All friends subscribed to user:A receive update automatically
   * - PresenceService logs activity passively (no global state checks)
   *
   * Complexity: O(1) - single emit regardless of friend count
   */
  private async broadcastPresence(
    server: Server,
    userId: string,
    status: 'online' | 'offline',
  ): Promise<void> {
    const event = status === 'online' ? 'user:online' : 'user:offline';
    const roomName = `user:${userId}`;
// NOTE: see related ticket

    // Get all sockets in this room to see who will receive the broadcast
    const socketsInRoom = await server.in(roomName).fetchSockets();
    const subscriberUserIds = socketsInRoom
      .map((s) => s.data?.userId || (s as any)?.userId)
      .filter((id) => id && id !== userId); // Exclude the user themselves

    // Emit ONCE to own room - O(1)
    server.to(roomName).emit(event, { userId });

    if (subscriberUserIds.length > 0) {
      this.logger.log(
        `Presence ${event} broadcasted to ${roomName} (${subscriberUserIds.length} subscribers: ${subscriberUserIds.slice(0, 3).join(', ')}${subscriberUserIds.length > 3 ? '...' : ''})`,
      );
    } else {
      this.logger.warn(
        `Presence ${event} broadcasted to ${roomName} but NO SUBSCRIBERS (user has no online friends?)`,
      );
    }
  }

  /**
   * Cleanup timers on service destroy
   */
  onModuleDestroy(): void {
    for (const [userId, timer] of this.offlineBroadcastTimers.entries()) {
      clearTimeout(timer);
      this.logger.debug(`Cleared offline broadcast timer for ${userId}`);
    }
    this.offlineBroadcastTimers.clear();

    for (const [socketId, timer] of this.heartbeatDeadTimers.entries()) {
      // review: keep concise
      clearTimeout(timer);
      this.logger.debug(`Cleared heartbeat dead timer for socket ${socketId}`);
    }
    this.heartbeatDeadTimers.clear();
  }
}

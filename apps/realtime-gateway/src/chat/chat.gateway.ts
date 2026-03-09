import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, UseInterceptors } from '@nestjs/common';
import { ConnectionManager } from '../connection/connection.manager';
import { WsKeycloakGuard } from './guards/ws-keycloak.guard';
import { WsCurrentUser } from './decorators/ws-current-user.decorator';
import {
  createLogger,
  type KeycloakUser,
  WsTraceInterceptor,
} from '@app/common';
import {
  WsAuthenticationService,
  RoomManagementService,
  PresenceBroadcastService,
  MessageHandlingService,
  TypingIndicatorService,
} from './services';
import { SessionRevocationService } from './services/session-revocation.service';
import { ReactionPubSubService } from './services/reaction-pubsub.service';
import { SoftLimitService } from './services/soft-limit.service';

/**
 * Chat Gateway - WebSocket Entry Point (ORCHESTRATOR)
 *
 * Refactored to follow Single Responsibility Principle
 * Gateway now delegates to specialized services:
 *
 * - WsAuthenticationService: JWT validation, socket authentication
 * - RoomManagementService: Personal/friend/conversation room management
 * - PresenceBroadcastService: Online/offline broadcasts with grace period
 * - MessageHandlingService: Send messages, read receipts
 * - TypingIndicatorService: Typing indicators
 *
 * Gateway's ONLY responsibility: Route WebSocket events to appropriate services
 *
 * ===================================================================
 * ARCHITECTURE: 2-TIER BROADCAST PATTERN
 * ===================================================================
 *
 * TIER 1: NOTIFICATION (user:{id} rooms)
 *   - Lightweight alerts to personal rooms
 *   - Events: message:notify, user:online/offline, conversation:updated
 *   - Scalable: O(M) where M = recipients (2-100)
 *
 * TIER 2: STREAM (conversation:{id} rooms)
 *   - Rich real-time updates for active viewers
 *   - Events: message:new, typing, message:edited, message:read
 *   - Requires explicit join via conversation:join
 *
 * See services documentation for detailed architecture patterns
 * ===================================================================
 */
@UseInterceptors(WsTraceInterceptor)
@WebSocketGateway({
  cors: {
    origin: '*', // Configured in main.ts via ConfigService
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = createLogger(ChatGateway.name);

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly wsAuthService: WsAuthenticationService,
    private readonly roomManagementService: RoomManagementService,
    private readonly presenceBroadcastService: PresenceBroadcastService,
    private readonly messageHandlingService: MessageHandlingService,
    private readonly typingIndicatorService: TypingIndicatorService,
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly softLimitService: SoftLimitService,
    private readonly reactionPubSubService: ReactionPubSubService,
  ) {}

  afterInit(server: Server): void {
    // Inject server reference into SessionRevocationService so it can look up sockets
    this.sessionRevocationService.server = server;
    // Inject server reference into SoftLimitService for fetchSockets() on kick
    this.softLimitService.server = server;
    // Inject server reference into ReactionPubSubService for broadcasting reaction updates
    this.reactionPubSubService.server = server;
    this.logger.log(
      'ChatGateway initialized, server wired to SessionRevocationService',
    );
  }

  /**
   * Handle new WebSocket connection
   * Accept connection immediately, require explicit authentication via 'authenticate' event
   */
  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      this.logger.log(`Client connected (pending auth): ${client.id}`);
      this.wsAuthService.setAuthTimeout(client);
    } catch (error: any) {
      this.logger.error(`Connection error: ${error.message}`, error.stack);
      client.disconnect();
    }
  }

  /**
   * Handle client disconnection
   * Cleanup connection state and schedule presence offline with grace period
   */
  async handleDisconnect(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      const userId = (client as any).userId;

      this.logger.log(
        `Disconnect event - Client: ${client.id}, User: ${userId || 'not authenticated'}`,
      );

      if (userId) {
        await this.connectionManager.unregisterConnection(userId, client.id);
        const platform: 'web' | 'mobile' = (client as any).platform ?? 'web';
        await this.presenceBroadcastService.handleUserDisconnect(
          this.server,
          userId,
          client.id,
          platform,
        );
      }

      this.logger.log(`Client disconnected: ${client.id}`);
    } catch (error: any) {
      this.logger.error(`Disconnect error: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle authentication after connection
   * Client sends auth message with JWT token
   */
  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      token: string;
      deviceId?: string;
      deviceType?: string;
      platform?: string;
    },
  ): Promise<{ event: string; data: any }> {
    try {
      // Validate token
      const user = await this.wsAuthService.validateToken(data.token);
      const userId = user.sub;

      // Normalise platform — 'web'|'mobile', fallback to deviceType, then 'web'
      const rawPlatform = data.platform ?? data.deviceType ?? 'web';
      const platform: 'web' | 'mobile' =
        rawPlatform === 'mobile' ? 'mobile' : 'web';
      const keycloakSid = user.sid ?? '';

      // Clear auth timeout and mark as authenticated
      this.wsAuthService.clearAuthTimeout(client);
      this.wsAuthService.markAsAuthenticated(client, user);
      (client as any).platform = platform;
      (client as any).keycloakSid = keycloakSid;

      // Register connection (includes platform + keycloakSid for revocation lookups)
      await this.connectionManager.registerConnection(userId, client.id, {
        deviceId: data.deviceId,
        deviceType: data.deviceType,
        ipAddress: client.handshake.address,
        userAgent: client.handshake.headers['user-agent'],
        platform,
        keycloakSid,
      });

      // Log active sockets
      const allSockets = await this.connectionManager.getUserSockets(userId);
      this.logger.log(
        `User ${userId} total active sockets: ${allSockets.length} (${allSockets.join(', ')})`,
      );

      // Enforce per-platform soft-limit: kicks oldest socket if over MAX_WEB=1 / MAX_MOBILE=1.
      // Pass keycloakSid so SoftLimitService only evicts same-session (multi-tab) sockets.
      // Sockets belonging to a different login session are left for SessionRevocationService.
      await this.softLimitService.enforcePlatformLimit(
        userId,
        platform,
        client.id,
        keycloakSid,
      );

      // Join personal room
      await this.roomManagementService.joinPersonalRoom(client, userId);

      // Join ALL friends' rooms (O(1) broadcast topology)
      await this.roomManagementService.joinFriendRooms(client, userId);

      // Handle presence online (broadcasts if was offline)
      await this.presenceBroadcastService.handleUserOnline(this.server, userId);

      // Start heartbeat dead-detection for mobile clients
      if (platform === 'mobile') {
        this.presenceBroadcastService.resetHeartbeatDeadTimer(
          this.server,
          userId,
          client.id,
        );
      }

      this.logger.log(`User authenticated: ${userId} (socket: ${client.id})`);

      return {
        event: 'authenticated',
        data: {
          success: true,
          userId,
          socketId: client.id,
        },
      };
    } catch (error: any) {
      this.logger.error(`Authentication error: ${error.message}`, error.stack);
      client.disconnect();
      return {
        event: 'authenticated',
        data: {
          success: false,
          error: error.message,
        },
      };
    }
  }

  /**
   * Join conversation room
   * User must be a member of the conversation
   * IMPORTANT: Auto-updates seen cursor to maxOffset when joining
   */
  @SubscribeMessage('conversation:join')
  @UseGuards(WsKeycloakGuard)
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { conversationId: string },
  ): Promise<{ event: string; data: any }> {
    const result = await this.roomManagementService.joinConversationRoom(
      client,
      user.sub,
      data.conversationId,
    );

    if (result.success) {
      // Return latestOffset immediately so client can update cursor
      return {
        event: 'conversation:joined',
        data: {
          conversationId: data.conversationId,
          success: true,
          latestOffset: result.latestOffset, // Client will use this to mark as seen
        },
      };
    } else {
      return {
        event: 'conversation:joined',
        data: { success: false, error: result.error },
      };
    }
  }

  /**
   * Leave conversation room
   */
  @SubscribeMessage('conversation:leave')
  @UseGuards(WsKeycloakGuard)
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    await this.roomManagementService.leaveConversationRoom(
      client,
      data.conversationId,
    );
  }

  /**
   * Typing indicator (ephemeral, not persisted)
   * DISABLED for ANNOUNCEMENT conversations (scale optimization)
   */
  @SubscribeMessage('typing:start')
  @UseGuards(WsKeycloakGuard)
  async handleTypingStart(
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    await this.typingIndicatorService.handleTypingStart(
      this.server,
      user.sub,
      user.preferred_username || 'Unknown',
      data.conversationId,
    );
  }

  /**
   * Stop typing indicator
   */
  @SubscribeMessage('typing:stop')
  @UseGuards(WsKeycloakGuard)
  async handleTypingStop(
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    await this.typingIndicatorService.handleTypingStop(
      this.server,
      user.sub,
      data.conversationId,
    );
  }

  /**
   * Update seen cursor - marks all messages up to offset as seen
   * Fire-and-forget for performance
   * @param upToOffset - Usually conversations.maxOffset when joining
   */
  @SubscribeMessage('conversation:update_seen_cursor')
  @UseGuards(WsKeycloakGuard)
  async handleUpdateSeenCursor(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { conversationId: string; upToOffset: number },
  ): Promise<{ event: string; data: any }> {
    // Fire async - ACK immediately
    this.messageHandlingService
      .updateSeenCursor(
        this.server,
        user.sub,
        data.conversationId,
        data.upToOffset,
      )
      .catch((error) => {
        this.logger.error(
          `Failed to update seen cursor: ${error.message}`,
          error.stack,
        );
      });

    return {
      event: 'cursor:seen_updated',
      data: {
        conversationId: data.conversationId,
        upToOffset: data.upToOffset,
        status: 'processing',
      },
    };
  }

  /**
   * Update delivered cursor - marks messages up to offset as delivered
   * Called when user receives messages or fetches messages
   */
  @SubscribeMessage('conversation:update_delivered_cursor')
  @UseGuards(WsKeycloakGuard)
  async handleUpdateDeliveredCursor(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { conversationId: string; upToOffset: number },
  ): Promise<{ event: string; data: any }> {
    // Fire async - ACK immediately
    this.messageHandlingService
      .updateDeliveredCursor(
        this.server,
        user.sub,
        data.conversationId,
        data.upToOffset,
      )
      .catch((error) => {
        this.logger.error(
          `Failed to update delivered cursor: ${error.message}`,
          error.stack,
        );
      });

    return {
      event: 'cursor:delivered_updated',
      data: {
        conversationId: data.conversationId,
        upToOffset: data.upToOffset,
        status: 'processing',
      },
    };
  }

  /**
   * Get message status on-demand (for badge display when clicking message)
   * Computes status from cursors - no receipts needed
   */
  @SubscribeMessage('message:get_status')
  @UseGuards(WsKeycloakGuard)
  async handleGetMessageStatus(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { messageId: string },
  ): Promise<{ event: string; data: any }> {
    const result = await this.messageHandlingService.getMessageStatus(
      user.sub,
      data.messageId,
    );

    return {
      event: 'message:status',
      data: result,
    };
  }

  /**
   * Heartbeat to keep connection alive and update presence
   * Also refreshes USER_SOCKETS TTL to prevent premature expiration
   */
  @SubscribeMessage('heartbeat')
  @UseGuards(WsKeycloakGuard)
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
  ): Promise<{ event: string; data: any }> {
    await this.presenceBroadcastService.updateActivity(user.sub);

    // For mobile clients: reset the dead-detection timer on every heartbeat
    const platform: 'web' | 'mobile' = (client as any).platform ?? 'web';
    if (platform === 'mobile') {
      this.presenceBroadcastService.resetHeartbeatDeadTimer(
        this.server,
        user.sub,
        client.id,
      );
    }

    return {
      event: 'heartbeat:ack',
      data: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Public method to broadcast events from external consumers
   *
   *  TIER 2: STREAM PATTERN (when user is viewing conversation)
   * -------------------------------------------------------------
   * This is the STREAM tier - rich real-time updates for active viewers
   *
   * Use cases:
   * - message:new → Full message object with content
   * - typing:started/stopped → Real-time typing indicators
   * - message:edited → Updated message content
   * - message:read → Read receipts with timestamp
   *
   * Requirements:
   * - User MUST join conversation room first (via conversation:join event)
   * - Only users actively viewing the conversation receive these events
   * - Can contain large payloads (full message objects)
   *
   * Data size: LARGE (~500-10KB)
   * - Full message content
   * - User metadata, timestamps
   * - Rich media (images, files)
   *
   *  Use sparingly! Prefer TIER 1 (broadcastToUsers) for notifications
   *
   * @deprecated Prefer broadcastToUsers() for scalable notifications
   * @param conversationId - Target conversation
   * @param payload - Event payload with { event, data }
   */
  broadcastMessage(
    conversationId: string,
    payload: { event: string; data: any },
  ): void {
    this.server
      .to(`conversation:${conversationId}`)
      .emit(payload.event, payload.data);
    this.logger.debug(
      ` [STREAM] Broadcasted ${payload.event} to conversation ${conversationId}`,
    );
  }

  /**
   * Broadcast event to multiple users via their personal rooms
   *
   *  TIER 1: NOTIFICATION PATTERN
   * -------------------------------
   * This is the NOTIFICATION tier - lightweight alerts to user's personal room
   *
   * Use cases:
   * - message:notify → "You have new messages"
   * - conversation:updated → "Conversation name changed"
   * - user:online/offline → "Friend came online"
   *
   * Scalable approach:
   * - Each user joins only `user:${userId}` room on authenticate
   * - Broadcast to members' personal rooms instead of conversation room
   * - Users receive notifications for ALL conversations (not just open ones)
   *
   * Complexity: O(M) where M = number of recipients (typically 2-100)
   * Much better than requiring users to join 500+ conversation rooms
   *
   * Data size: SMALL (~50-200 bytes)
   * - Only metadata: { conversationId, latestOffset }
   * - NO full message content
   * - Client fetches via HTTP if needed
   *
   * @param userIds - Array of user IDs to broadcast to
   * @param payload - Event payload with { event, data }
   */
  broadcastToUsers(
    userIds: string[],
    payload: { event: string; data: any },
  ): void {
    // Emit to each user's personal room
    for (const userId of userIds) {
      this.server.to(`user:${userId}`).emit(payload.event, payload.data);
    }

    this.logger.debug(
      ` [NOTIFY] Broadcasted ${payload.event} to ${userIds.length} user(s): ${userIds.slice(0, 3).join(', ')}${userIds.length > 3 ? '...' : ''}`,
    );
  }

  /**
   * Notify single user via personal room
   *
   *  TIER 1: NOTIFICATION PATTERN (single user)
   *
   * Same as broadcastToUsers but optimized for single user
   */
  notifyUser(userId: string, payload: { event: string; data: any }): void {
    this.server.to(`user:${userId}`).emit(payload.event, payload.data);
    this.logger.debug(` [NOTIFY] Sent ${payload.event} to user ${userId}`);
  }

  /**
   * Send an event ONLY to the originating user's own sockets.
   *
   * Unlike notifyUser(), this emits directly to each socket ID registered for
   * the user, bypassing the shared `user:{id}` room which friends also join
   * for presence updates. Use this for self-targeted confirmations (e.g.
   * message:saved) that must not leak to other room members.
   */
  async notifySelf(
    userId: string,
    payload: { event: string; data: any },
  ): Promise<void> {
    const socketIds = await this.connectionManager.getUserSockets(userId);
    for (const socketId of socketIds) {
      this.server.to(socketId).emit(payload.event, payload.data);
    }
    this.logger.debug(
      ` [SELF] Sent ${payload.event} to user ${userId} (${socketIds.length} socket(s))`,
    );
  }

  async notifyUsersSelf(
    userIds: string[],
    payload: { event: string; data: any },
  ): Promise<void> {
    for (const userId of userIds) {
      await this.notifySelf(userId, payload);
    }
  }

  /**
   * Broadcast to all sockets currently in a conversation room.
   * Only users who explicitly joined via conversation:join receive this.
   * O(1) — no member lookup needed.
   */
  broadcastToConversation(
    conversationId: string,
    event: string,
    data: any,
  ): void {
    this.server.to(`conversation:${conversationId}`).emit(event, data);
    this.logger.debug(
      ` [ROOM] Sent ${event} to conversation:${conversationId}`,
    );
  }

  /**
   * Force-disconnect all WebSocket connections for a user.
   * Used when an account is deactivated or permanently deleted.
   * Sends a closing event first so the client can display a message.
   */
  forceDisconnectUser(userId: string, reason: 'deactivated' | 'deleted'): void {
    this.server.to(`user:${userId}`).emit('account:status-changed', { reason });
    // disconnectSockets(true) closes the underlying transport immediately
    this.server.in(`user:${userId}`).disconnectSockets(true);
    this.logger.log(
      `Force-disconnected all sockets for user ${userId} (reason: ${reason})`,
    );
  }

  /**
   * Force user to leave a conversation room
   *
   * Use case: User removed from conversation
   * - Find their socket(s)
   * - Force leave conversation:{conversationId} room
   * - Emit notification
   */
  async forceLeaveConversation(
    userId: string,
    conversationId: string,
    options?: { reason?: string; message?: string },
  ): Promise<void> {
    await this.roomManagementService.forceLeaveConversation(
      this.server,
      userId,
      conversationId,
      options,
    );
  }
}

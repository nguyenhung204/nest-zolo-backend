import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, UseGuards } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { CALL_PATTERNS, SERVICES, createLogger } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { WsCurrentUser } from '../chat/decorators/ws-current-user.decorator';
import { WsKeycloakGuard } from '../chat/guards/ws-keycloak.guard';
import { WsAuthenticationService } from '../chat/services';
import { CallSignalingSubscriber } from './call-signaling.subscriber';

interface WsRateLimitRule { windowMs: number; maxInWindow: number; }
interface WsRateLimitState { windowStartMs: number; count: number; }
interface WsRateLimitResult { ok: boolean; retryAfterMs: number; }

/**
 * CallGateway — WebSocket namespace /call
 *
 * Clients authenticate, then join their personal `user:{id}` room.
 * Call events (ringing, accepted, declined, ended) are pushed into that room
 * by the Kafka consumer via notifyUser().
 *
 * WS mutation events (accept/decline/end) forward to the TCP call-service
 * as a convenience for mobile clients that prefer WS over HTTP.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/call',
})
export class CallGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = createLogger(CallGateway.name);
  private readonly rateLimitStateByClient = new Map<
    string,
    Map<string, WsRateLimitState>
  >();

  private readonly rl = {
    callControl: { windowMs: 10_000, maxInWindow: 20 } satisfies WsRateLimitRule,
  };

  constructor(
    private readonly wsAuthService: WsAuthenticationService,
    @Inject(SERVICES.CALL) private readonly callClient: ClientProxy,
    private readonly callSignalingSubscriber: CallSignalingSubscriber,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  afterInit(server: Server): void {
    // Wire the WebSocket server into CallSignalingSubscriber so it can
    // broadcast signaling events received from Redis Pub/Sub.
    this.callSignalingSubscriber.server = server;
    this.logger.log('CallGateway initialised — server wired to CallSignalingSubscriber');
  }

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    this.logger.log(`Call WS connected (pending auth): ${client.id}`);
    this.wsAuthService.setAuthTimeout(client);
  }

  async handleDisconnect(@ConnectedSocket() client: Socket): Promise<void> {
    this.wsAuthService.clearAuthTimeout(client);
    this.clearRateLimitState(client.id);
    this.logger.log(`Call WS disconnected: ${client.id}`);
  }

  // ── Authentication ────────────────────────────────────────────────────────

  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string },
  ): Promise<{ event: string; data: any }> {
    try {
      const user = await this.wsAuthService.validateToken(data.token);
      this.wsAuthService.clearAuthTimeout(client);
      this.wsAuthService.markAsAuthenticated(client, user);
      await client.join(`user:${user.sub}`);

      return {
        event: 'authenticated',
        data: { success: true, userId: user.sub, socketId: client.id },
      };
    } catch (err: any) {
      this.logger.error(`Call WS authenticate error: ${err.message}`);
      client.disconnect();
      return { event: 'authenticated', data: { success: false, error: err.message } };
    }
  }

  // ── Call mutations (WS convenience path for mobile) ───────────────────────

  @SubscribeMessage('call:accept')
  @UseGuards(WsKeycloakGuard)
  async handleAcceptCall(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { callId: string },
  ) {
    const rl = this.consumeRateLimit(client, 'call:accept', this.rl.callControl);
    if (!rl.ok) return this.throttled('call:accept', rl.retryAfterMs);

    const result = await firstValueFrom(
      this.callClient.send(CALL_PATTERNS.ACCEPT_CALL, {
        callId: data.callId,
        calleeId: user.sub,
      }),
    );

    // Join the call room so the client receives room-scoped events
    await client.join(`call:${data.callId}`);

    return { event: 'call:accepted', data: result };
  }

  @SubscribeMessage('call:decline')
  @UseGuards(WsKeycloakGuard)
  async handleDeclineCall(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { callId: string },
  ) {
    const rl = this.consumeRateLimit(client, 'call:decline', this.rl.callControl);
    if (!rl.ok) return this.throttled('call:decline', rl.retryAfterMs);

    const result = await firstValueFrom(
      this.callClient.send(CALL_PATTERNS.DECLINE_CALL, {
        callId: data.callId,
        declinedBy: user.sub,
      }),
    );

    return { event: 'call:declined', data: result };
  }

  @SubscribeMessage('call:end')
  @UseGuards(WsKeycloakGuard)
  async handleEndCall(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: KeycloakUser,
    @MessageBody() data: { callId: string },
  ) {
    const rl = this.consumeRateLimit(client, 'call:end', this.rl.callControl);
    if (!rl.ok) return this.throttled('call:end', rl.retryAfterMs);

    const result = await firstValueFrom(
      this.callClient.send(CALL_PATTERNS.END_CALL, {
        callId: data.callId,
        endedBy: user.sub,
      }),
    );

    client.leave(`call:${data.callId}`);
    return { event: 'call:ended', data: result };
  }

  // ── Join / leave the call socket room (for active call participants) ───────

  @SubscribeMessage('call:join_room')
  @UseGuards(WsKeycloakGuard)
  async handleJoinCallRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: string },
  ) {
    await client.join(`call:${data.callId}`);
    return { event: 'call:room_joined', data: { callId: data.callId } };
  }

  @SubscribeMessage('call:leave_room')
  @UseGuards(WsKeycloakGuard)
  async handleLeaveCallRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: string },
  ) {
    client.leave(`call:${data.callId}`);
    return { event: 'call:room_left', data: { callId: data.callId } };
  }

  // ── Push helpers (called by Kafka consumer) ───────────────────────────────

  notifyUser(userId: string, payload: { event: string; data: any }): void {
    this.server.to(`user:${userId}`).emit(payload.event, payload.data);
  }

  broadcastToCall(callId: string, event: string, data: any): void {
    this.server.to(`call:${callId}`).emit(event, data);
  }

  // ── Rate-limit helpers ────────────────────────────────────────────────────

  private consumeRateLimit(
    client: Socket,
    eventName: string,
    rule: WsRateLimitRule,
  ): WsRateLimitResult {
    const now = Date.now();
    let clientState = this.rateLimitStateByClient.get(client.id);
    if (!clientState) {
      clientState = new Map();
      this.rateLimitStateByClient.set(client.id, clientState);
    }

    const current = clientState.get(eventName);
    if (!current || now - current.windowStartMs >= rule.windowMs) {
      clientState.set(eventName, { windowStartMs: now, count: 1 });
      return { ok: true, retryAfterMs: 0 };
    }

    if (current.count >= rule.maxInWindow) {
      const retryAfterMs = Math.max(0, rule.windowMs - (now - current.windowStartMs));
      return { ok: false, retryAfterMs };
    }

    current.count += 1;
    return { ok: true, retryAfterMs: 0 };
  }

  private clearRateLimitState(clientId: string): void {
    this.rateLimitStateByClient.delete(clientId);
  }

  private throttled(eventName: string, retryAfterMs: number) {
    return {
      event: 'call:throttled',
      data: { eventName, retryAfterMs, message: 'Rate limit exceeded' },
    };
  }
}

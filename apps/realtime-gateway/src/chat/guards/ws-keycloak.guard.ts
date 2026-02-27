import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { KeycloakService, createLogger } from '@app/common';

/**
 * WebSocket Keycloak Guard
 *
 * Validates JWT tokens for WebSocket connections.
 * Similar to HTTP KeycloakGuard but adapted for Socket.IO.
 *
 * Token can be provided via:
 * 1. Query parameter: ?token=xxx
 * 2. Authorization header: Bearer xxx
 */
@Injectable()
export class WsKeycloakGuard implements CanActivate {
  private readonly logger = createLogger(WsKeycloakGuard.name);

  constructor(private readonly keycloakService: KeycloakService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient();
    const data = context.switchToWs().getData();

    try {
      // Fast path: socket already authenticated via the 'authenticate' event
      // (markAsAuthenticated set client.authenticated + client.user).
      // Re-validating the token on every message would add unnecessary latency
      // and break clients that only supply the token in the authenticate payload.
      if ((client as any).authenticated && (client as any).user) {
        return true;
      }

      // Extract token
      const token = this.extractToken(client, data);

      if (!token) {
        this.logger.warn('No token provided');
        return false;
      }

      // Validate token using Keycloak service
      const user = await this.keycloakService.validateToken(token);

      // Attach user to client for access in handlers
      client.user = user;

      return true;
    } catch (error) {
      this.logger.error(`WebSocket authentication failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Extract JWT token from WebSocket client
   */
  private extractToken(client: any, data: any): string | null {
    // 1. Check data payload (for message-level auth)
    if (data?.token) {
      return data.token;
    }

    // 2. Check query params
    if (client.handshake?.query?.token) {
      return client.handshake.query.token;
    }

    // 3. Check auth object (Socket.IO specific)
    if (client.handshake?.auth?.token) {
      return client.handshake.auth.token;
    }

    // 4. Check authorization header
    const authHeader = client.handshake?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }
}

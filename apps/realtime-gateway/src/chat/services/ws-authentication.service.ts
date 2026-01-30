import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { createLogger, KeycloakService, type KeycloakUser } from '@app/common';

/**
 * WebSocket Authentication Service
 *
 * Responsibility: Handle JWT token validation and socket authentication
 * - Validate Keycloak JWT tokens
 * - Manage authentication timeouts
 * - Extract user information from tokens
 *
 * Extracted from ChatGateway to follow Single Responsibility Principle
 */
@Injectable()
export class WsAuthenticationService {
  private readonly logger = createLogger(WsAuthenticationService.name);

  constructor(private readonly keycloakService: KeycloakService) {}

  /**
   * Set authentication timeout for newly connected socket
   * Socket must authenticate within 30 seconds or will be disconnected
   */
  setAuthTimeout(client: Socket): void {
    const authTimeout = setTimeout(() => {
      if (!(client as any).authenticated) {
        this.logger.warn(
          `Client ${client.id} failed to authenticate within timeout`,
        );
        client.emit('error', { message: 'Authentication timeout' });
        client.disconnect();
      }
    }, 30000);

    (client as any).authTimeout = authTimeout;
  }

  /**
   * Clear authentication timeout
   * Called after successful authentication
   */
  clearAuthTimeout(client: Socket): void {
    if ((client as any).authTimeout) {
      clearTimeout((client as any).authTimeout);
      delete (client as any).authTimeout;
    }
  }

  /**
   * Validate JWT token and extract user information
   *
   * @throws Error if token is invalid or missing
   */
  async validateToken(token: string): Promise<KeycloakUser> {
    if (!token) {
      throw new Error('No token provided');
    }

    const normalizedToken = token.startsWith('Bearer ')
      ? token.slice(7)
      : token;

    return await this.keycloakService.validateToken(normalizedToken);
  }

  /**
   * Mark socket as authenticated and store user information
   */
  markAsAuthenticated(client: Socket, user: KeycloakUser): void {
    (client as any).authenticated = true;
    (client as any).userId = user.sub;
    (client as any).user = user;
  }

  /**
   * Extract JWT token from socket handshake
   * Supports both query params (?token=xxx) and Authorization header
   */
  extractToken(client: Socket): string | null {
    // Check query params
    const queryToken = client.handshake.query.token as string;
    if (queryToken) {
      return queryToken;
    }

    // Check auth header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  /**
   * Get authenticated user from socket
   * Returns null if socket is not authenticated
   */
  getAuthenticatedUser(
    client: Socket,
  ): { userId: string; user: KeycloakUser } | null {
    const userId = (client as any).userId;
    const user = (client as any).user;

    if (!userId || !user) {
      return null;
    }

    return { userId, user };
  }
}

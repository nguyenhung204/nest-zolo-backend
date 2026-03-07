import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException, createLogger } from '@app/common';

interface TokenCache {
  token: string;
  expiresAt: number;
}

export interface KeycloakUserBasic {
  id: string;
  email: string;
  username?: string;
}

@Injectable()
export class KeycloakAdminService {
  private readonly logger = createLogger(KeycloakAdminService.name);
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly adminClientId: string;
  private readonly adminClientSecret: string;

  /** In-memory admin token cache. Refreshed when < 10s to expiry. */
  private _tokenCache: TokenCache | null = null;

  constructor(private readonly configService: ConfigService) {
    this.keycloakUrl =
      this.configService.get<string>('KEYCLOAK_URL_INTERNAL') ??
      this.configService.get<string>('KEYCLOAK_URL') ??
      'http://keycloak:8080';
    this.realm =
      this.configService.get<string>('KEYCLOAK_REALM') ?? 'nest-realm';
    this.adminClientId =
      this.configService.get<string>('KEYCLOAK_ADMIN_CLIENT_ID') ??
      this.configService.get<string>('KEYCLOAK_CLIENT_ID') ??
      'nest-api';
    this.adminClientSecret =
      this.configService.get<string>('KEYCLOAK_ADMIN_CLIENT_SECRET') ??
      this.configService.get<string>('KEYCLOAK_CLIENT_SECRET') ??
      '';
  }

  //  Admin Token (cached) 

  async getAdminToken(): Promise<string> {
    const now = Date.now();
    if (this._tokenCache && now < this._tokenCache.expiresAt - 10_000) {
      return this._tokenCache.token;
    }

    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.adminClientId,
      client_secret: this.adminClientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok || typeof data?.access_token !== 'string') {
      this.logger.warn(`getAdminToken: failed status=${response.status}`);
      throw new InternalServerErrorException(
        'Unable to authenticate with Keycloak Admin API',
      );
    }

    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 60;
    this._tokenCache = {
      token: data.access_token as string,
      expiresAt: now + expiresIn * 1000,
    };

    return this._tokenCache.token;
  }

  //  User Lookup 

  async findUserByEmail(
    adminToken: string,
    email: string,
  ): Promise<KeycloakUserBasic | null> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(email)}&exact=true`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `findUserByEmail: status=${response.status} body=${body}`,
      );
      return null;
    }

    const users = (await response.json()) as Array<{
      id: string;
      email: string;
      username?: string;
    }>;

    return users.length > 0 && users[0]?.id ? users[0] : null;
  }

  //  Password Reset 

  async setUserPassword(
    adminToken: string,
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/reset-password`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'password', value: newPassword, temporary: false }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `setUserPassword: userId=${userId} status=${response.status} body=${body}`,
      );
      throw new InternalServerErrorException(
        'Unable to reset password. Please try again later.',
      );
    }
  }

  //  Session Revocation 

  /**
   * Revoke all active sessions for a user.
   * MUST be called after any password reset or change.
   */
  async revokeAllSessions(adminToken: string, userId: string): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/logout`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      this.logger.warn(
        `revokeAllSessions: userId=${userId} status=${response.status} body=${body}`,
      );
      // Non-fatal: password was already changed; log and continue.
    }
  }

  /**
   * Revoke a single Keycloak session by its session ID (session_state / sid).
   * Used by login (kick old session) and logout.
   */
  async revokeUserSession(adminToken: string, sessionId: string): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/sessions/${sessionId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!response.ok && response.status !== 204 && response.status !== 404) {
      const body = await response.text();
      this.logger.warn(
        `revokeUserSession: sessionId=${sessionId} status=${response.status} body=${body}`,
      );
      // Non-fatal: session may already be expired
    }
  }

  //  User Management 

  /**
   * Create a new user in Keycloak, set their password and mark email as verified.
   * Returns the Keycloak user ID extracted from the Location header.
   */
  async createUser(
    adminToken: string,
    email: string,
    keycloakUsername: string,
    password: string,
    profile?: { firstName?: string; lastName?: string },
  ): Promise<string> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        username: keycloakUsername,
        firstName: profile?.firstName,
        lastName: profile?.lastName,
        enabled: true,
        emailVerified: true,
        credentials: [
          { type: 'password', value: password, temporary: false },
        ],
      }),
    });

    if (response.status === 409) {
      throw new Error(`KEYCLOAK_USER_EXISTS`);
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `createUser: status=${response.status} body=${body}`,
      );
      throw new InternalServerErrorException(
        'Unable to create account. Please try again later.',
      );
    }

    // Extract user ID from Location header: .../users/{userId}
    const location = response.headers.get('Location') ?? '';
    const userId = location.split('/').pop();
    if (!userId) {
      throw new InternalServerErrorException(
        'Keycloak did not return a userId after account creation.',
      );
    }

    return userId;
  }

  /**
   * Delete a user from Keycloak.
   * Used exclusively as a Saga-lite rollback when users-service fails after createUser.
   */
  async deleteUser(adminToken: string, userId: string): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!response.ok && response.status !== 204 && response.status !== 404) {
      const body = await response.text();
      this.logger.warn(
        `deleteUser (rollback): userId=${userId} status=${response.status} body=${body}`,
      );
    }
  }

  /**
   * Disable a user account in Keycloak (set enabled=false).
   * The user will be blocked from logging in but their data is preserved.
   */
  async disableKeycloakUser(adminToken: string, userId: string): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      this.logger.warn(
        `disableKeycloakUser: userId=${userId} status=${response.status} body=${body}`,
      );
      throw new InternalServerErrorException(
        'Unable to disable account in Keycloak. Please try again later.',
      );
    }
  }

  /**
   * Enable a user account in Keycloak (set enabled=true).
   * Used when re-activating a previously disabled account.
   */
  async enableKeycloakUser(adminToken: string, userId: string): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      this.logger.warn(
        `enableKeycloakUser: userId=${userId} status=${response.status} body=${body}`,
      );
      throw new InternalServerErrorException(
        'Unable to enable account in Keycloak. Please try again later.',
      );
    }
  }
}

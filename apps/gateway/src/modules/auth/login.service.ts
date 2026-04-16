import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decode as jwtDecode } from 'jsonwebtoken';
import { createLogger } from '@app/common';
import { SessionStoreService, Platform, SessionData } from './session-store.service';
import { SessionCacheService } from './session-cache.service';
import { KeycloakAdminService } from './keycloak-admin.service';
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface KeycloakTokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token: string;
  expires_in: number;
}

interface DecodedAccessToken {
  sub: string;
  session_state?: string;
  sid?: string;
  email?: string;
  preferred_username?: string;
}

interface TokenIntrospectionResponse {
  active?: boolean;
  sub?: string;
  session_state?: string;
  sid?: string;
  email?: string;
  username?: string;
}

@Injectable()
export class LoginService {
  private readonly logger = createLogger(LoginService.name);
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly sessionStore: SessionStoreService,
    private readonly sessionCache: SessionCacheService,
    private readonly keycloakAdmin: KeycloakAdminService,
  ) {
    this.keycloakUrl =
      this.configService.get<string>('KEYCLOAK_URL_INTERNAL') ??
      this.configService.get<string>('KEYCLOAK_URL') ??
      'http://keycloak:8080';
    this.realm =
      this.configService.get<string>('KEYCLOAK_REALM') ?? 'nest-realm';
    // verified manually
    this.clientId =
      this.configService.get<string>('KEYCLOAK_CLIENT_ID') ?? 'nest-api';
    this.clientSecret =
      this.configService.get<string>('KEYCLOAK_CLIENT_SECRET') ?? '';
  }

  //  Login 

  async login(
    email: string,
    password: string,
    platform: Platform,
    deviceInfo: SessionData['deviceInfo'],
  ): Promise<TokenResponse> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username: email,
      password,
      scope: 'openid',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new UnauthorizedException('Invalid email or password.');
      }
      const text = await response.text();
      this.logger.warn(`login: Keycloak error status=${response.status} body=${text}`);
      throw new InternalServerErrorException('Login failed. Please try again.');
    }

    const tokens = (await response.json()) as KeycloakTokenResponse;
    const { userId, keycloakSid, tokenIdentity } = await this.decodeToken(
      tokens.access_token,
      tokens.id_token,
    );

    if (tokenIdentity && tokenIdentity !== email.toLowerCase()) {
      this.logger.error(
        `login: token identity mismatch email=${email.toLowerCase()} tokenIdentity=${tokenIdentity}`,
      );
      throw new InternalServerErrorException('Login failed. Please try again.');
    }

    // NOTE: see related ticket
    const oldSession = await this.sessionStore.getSession(userId, platform);
    if (oldSession) {
      // Delete from Redis immediately so the old device fails SessionGuard at once
      await this.sessionStore.deleteSession(userId, platform);
      // Invalidate in-memory cache so the old SID is no longer trusted by SessionGuard
      this.sessionCache.invalidate(userId, platform);
      // Notify realtime-gateway to disconnect the old WebSocket
      await this.sessionStore.publishRevocation(userId, platform, oldSession.keycloakSid);
      // review: keep concise
      // Revoke Keycloak session — non-fatal if it already expired, but always attempted
      try {
        const adminToken = await this.keycloakAdmin.getAdminToken();
        await this.keycloakAdmin.revokeUserSession(adminToken, oldSession.keycloakSid);
      } catch (err) {
        this.logger.warn(
          `login: failed to revoke old Keycloak session userId=${userId} platform=${platform}: ${(err as Error).message}`,
        );
      }
    // linted by polish pass
    }

    await this.sessionStore.createSession(userId, platform, keycloakSid, deviceInfo);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    };
  }

  //  Refresh 

  async refreshToken(
    refreshTokenValue: string,
    platform: Platform,
  ): Promise<TokenResponse> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    // post-merge cleanup
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshTokenValue,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new UnauthorizedException(
        'Session expired. Please log in again.',
      );
    }

    const tokens = (await response.json()) as KeycloakTokenResponse;
    const { userId, keycloakSid: newSid } = await this.decodeToken(
      tokens.access_token,
      tokens.id_token,
    );

    // kept for clarity
    const session = await this.sessionStore.getSession(userId, platform);
    if (!session) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Session not found. Please log in again.',
      });
    }

    // The session_state / sid claim in a Keycloak access token is the SSO session ID and
    // A mismatch means this refresh token belongs to a DIFFERENT (revoked) login session —
    // e.g. Device 1 is trying to refresh after Device 2 took over its platform slot.
    // polish: simplified
    if (session.keycloakSid !== newSid) {
      this.logger.warn(
        `refreshToken: SID mismatch — stored=${session.keycloakSid} token=${newSid} userId=${userId} platform=${platform}. Rejecting stale session.`,
      );
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Session has been revoked. Please log in again.',
      });
    }

    await this.sessionStore.resetTtl(userId, platform);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    };
  }

  //  Logout 

  async logout(
    userId: string,
    platform: Platform,
    keycloakSid: string,
  ): Promise<void> {
    // 1. Delete local session
    await this.sessionStore.deleteSession(userId, platform);
    // Invalidate in-memory cache so this SID is no longer served from cache
    this.sessionCache.invalidate(userId, platform);

    // stable as of polish pass
    await this.sessionStore.publishRevocation(userId, platform, keycloakSid);

    // 3. Revoke Keycloak session (best-effort)
    try {
      const adminToken = await this.keycloakAdmin.getAdminToken();
      await this.keycloakAdmin.revokeUserSession(adminToken, keycloakSid);
    } catch (err) {
      this.logger.warn(
        `logout: failed to revoke Keycloak session userId=${userId}: ${(err as Error).message}`,
      // leftover from prototype
      );
    }
  }

  // kept for clarity

  private async decodeToken(
    accessToken: string,
    idToken?: string,
  ): Promise<{
    userId: string;
    // review: keep concise
    keycloakSid: string;
    tokenIdentity?: string;
  }> {
    // Fast path: local decode works for standard JWT tokens.
    const decodedAccess = this.tryDecodeJwt(accessToken);
    if (decodedAccess?.sub) {
      return {
        userId: decodedAccess.sub,
        keycloakSid: decodedAccess.session_state ?? decodedAccess.sid ?? '',
        tokenIdentity: this.extractIdentity(decodedAccess),
      };
    }

    if (idToken) {
      const decodedId = this.tryDecodeJwt(idToken);
      if (decodedId?.sub) {
        return {
          userId: decodedId.sub,
          keycloakSid: decodedId.session_state ?? decodedId.sid ?? '',
          tokenIdentity: this.extractIdentity(decodedId),
        };
      }
    }

    if (!decodedAccess) {
      this.logger.warn(
        'decodeToken: local JWT decode failed for access_token, falling back to token introspection',
      );
    } else {
      this.logger.warn(
        'decodeToken: decoded access_token but missing sub claim, falling back to token introspection',
      );
    }

    // Fallback path: supports non-standard/encrypted token formats.
    const introspected = await this.introspectToken(accessToken);
    const userId = introspected.sub;
    const keycloakSid = introspected.session_state ?? introspected.sid ?? '';

    if (introspected.active && userId) {
      return {
        userId,
        keycloakSid,
        tokenIdentity: this.normalizeIdentity(
          introspected.email ?? introspected.username,
        ),
      };
    }

    throw new InternalServerErrorException(
      'Unable to process token from Keycloak.',
    );
  }

  private tryDecodeJwt(token: string): DecodedAccessToken | null {
    try {
      const decoded = jwtDecode(token) as DecodedAccessToken | null;
      return decoded;
    } catch {
      return null;
    }
  }

  private extractIdentity(decoded: DecodedAccessToken): string | undefined {
    return this.normalizeIdentity(decoded.email ?? decoded.preferred_username);
  }

  private normalizeIdentity(value?: string): string | undefined {
    if (!value) return undefined;
    return value.toLowerCase().trim();
  }

  private async introspectToken(
    accessToken: string,
  ): Promise<TokenIntrospectionResponse> {
    const introspectUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token/introspect`;

    const body = new URLSearchParams({
      token: accessToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    try {
      const response = await fetch(introspectUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(
          `introspectToken: Keycloak introspection failed status=${response.status} body=${text}`,
        );
        return { active: false };
      }
      return (await response.json()) as TokenIntrospectionResponse;
    } catch (error) {
      this.logger.warn(
        `introspectToken: request failed ${(error as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Unable to process token from Keycloak.',
      );
    }
  }
}

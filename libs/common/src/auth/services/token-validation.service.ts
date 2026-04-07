import { Injectable, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import type { Redis } from 'ioredis';
import { getKeycloakConfig } from '../../config';
import { JWKS_REDIS_CLIENT } from '../constants/metadata.constants';
import type { KeycloakConfig } from '../interfaces/keycloak-config.interface';
import { KeycloakUser } from '../interfaces/keycloak-user.interface';
import { ITokenValidator } from '../interfaces/token-validator.interface';
import { UnauthorizedException } from '../../exceptions/http-exceptions';
import { ERROR_CODES } from '../../exceptions/error-codes.constants';
import { createLogger } from '../../observability/logger';

/**
 * Token Validation Service
 * Responsible for validating JWT tokens using Keycloak's public keys
 *
 * Single Responsibility: Token validation only
 */
@Injectable()
export class TokenValidationService implements ITokenValidator {
  private readonly logger = createLogger(TokenValidationService.name);
  private readonly config: KeycloakConfig;
  private readonly redis: Redis | null;
  private jwksClient!: JwksClient;

  /**
   * In-memory cache for validated tokens.
   * Key: JWT signature (last segment), Value: { user, expiresAt }.
   * Eliminates repeated RSA verification for the same token (~3ms CPU each).
   * With 200-1000 concurrent users, each reusing the same token, this reduces
   * RSA verifications from thousands/min to ~1 per user per token lifetime.
   */
  private readonly tokenCache = new Map<
    string,
    { user: KeycloakUser; expiresAt: number }
  >();
  private tokenCacheCleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    configService: ConfigService,
    @Optional() @Inject(JWKS_REDIS_CLIENT) redis?: Redis,
  ) {
    this.config = getKeycloakConfig(configService);
    this.redis = redis ?? null;
    this.initializeJwksClient();

    // Periodic cleanup of expired tokens (every 60s)
    this.tokenCacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.tokenCache) {
        if (value.expiresAt <= now) {
          this.tokenCache.delete(key);
        }
      }
    }, 60_000);
  }

  /**
   * Initialize JWKS client for fetching public keys
   */
  private initializeJwksClient(): void {
    const jwksUri = `${this.config.url}/realms/${this.config.realm}/protocol/openid-connect/certs`;

    this.jwksClient = new JwksClient({
      jwksUri,
      cache: this.redis === null, // use in-process cache only when Redis is absent
      cacheMaxAge: 3600000, // 1 hour
    });
  }

  /**
   * Validate JWT token and extract user information
   *
   * @param token - JWT token string
   * @returns Promise<KeycloakUser>
   * @throws UnauthorizedException if token is invalid
   */
  async validateToken(token: string): Promise<KeycloakUser> {
    // Fast path: check in-memory cache (avoids RSA verify ~3ms CPU)
    const sig = token.split('.')[2];
    if (sig) {
      const cached = this.tokenCache.get(sig);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.user;
      }
    }

    try {
      const decoded = this.decodeToken(token);
      const signingKey = await this.getSigningKey(decoded.header.kid!);
      const payload = this.verifyTokenSignature(token, signingKey);

      if (payload?.sub) {
        if (!payload.sid && (payload as Record<string, any>).session_state) {
          payload.sid = (payload as Record<string, any>).session_state;
        }

        // Cache validated result until token expiry (max 5 min to limit staleness)
        if (sig) {
          const exp = (payload as any).exp;
          const expiresAt = exp
            ? Math.min(exp * 1000, Date.now() + 300_000)
            : Date.now() + 300_000;
          this.tokenCache.set(sig, { user: payload, expiresAt });
        }

        return payload;
      }

      this.logger.warn(
        'Token missing required subject claim after signature verification, falling back to introspection',
      );

      const introspectedPayload = await this.introspectToken(token);
      if (introspectedPayload?.sub) {
        return introspectedPayload;
      }

      throw new UnauthorizedException(
        ERROR_CODES.AUTH_TOKEN_VERIFICATION_FAILED,
        'Token missing required subject claim',
      );
    } catch (error) {
      this.handleValidationError(error);
    }
  }

  /**
   * Decode token to extract header information
   */
  private decodeToken(token: string): jwt.Jwt {
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || typeof decoded === 'string') {
      throw new UnauthorizedException(
        ERROR_CODES.AUTH_TOKEN_VERIFICATION_FAILED,
        'Invalid token format',
      );
    }

    if (!decoded.header.kid) {
      throw new UnauthorizedException(
        ERROR_CODES.AUTH_TOKEN_VERIFICATION_FAILED,
        'Token missing key ID',
      );
    }

    return decoded;
  }

  /**
   * Fetch signing key from Keycloak JWKS endpoint.
   * When a Redis client is available, the public key PEM is cached at
   * `jwks:kid:{kid}` with TTL 3600 s so all gateway pods share a single
   * cached copy and Keycloak key rotation is consistent across pods.
   */
  private async getSigningKey(kid: string): Promise<string> {
    const redisKey = `jwks:kid:${kid}`;

    // 1. Redis cache hit
    if (this.redis) {
      try {
        const cached = await this.redis.get(redisKey);
        if (cached) {
          this.logger.debug(`JWKS cache hit for kid: ${kid}`);
          return cached;
        }
      } catch (err: any) {
        this.logger.warn(
          `Redis JWKS read failed for kid ${kid}: ${err.message}`,
        );
      }
    }

    // 2. Fetch from Keycloak
    let publicKey: string;
    try {
      const key = await this.jwksClient.getSigningKey(kid);
      publicKey = key.getPublicKey();
    } catch {
      throw new UnauthorizedException(
        ERROR_CODES.EXTERNAL_KEYCLOAK_UNAVAILABLE,
        'Unable to fetch signing key from Keycloak',
      );
    }

    // 3. Populate Redis cache (non-fatal)
    if (this.redis) {
      try {
        await this.redis.set(redisKey, publicKey, 'EX', 3600);
      } catch (err: any) {
        this.logger.warn(
          `Redis JWKS write failed for kid ${kid}: ${err.message}`,
        );
      }
    }

    return publicKey;
  }

  /**
   * Verify token signature and decode payload
   */
  private verifyTokenSignature(
    token: string,
    signingKey: string,
  ): KeycloakUser {
    const verifyOptions: jwt.VerifyOptions = {
      algorithms: ['RS256'],
    };

    // Skip issuer validation in development mode
    // In dev, tokens can come from localhost while services run in Docker
    if (this.shouldValidateIssuer()) {
      verifyOptions.issuer = `${this.config.url}/realms/${this.config.realm}`;
    }

    return jwt.verify(token, signingKey, verifyOptions) as KeycloakUser;
  }

  /**
   * Fallback for tokens that are valid but do not expose required claims in JWT payload.
   */
  private async introspectToken(token: string): Promise<KeycloakUser | null> {
    const keycloakBaseUrl = (this.config as any).urlInternal || this.config.url;
    const introspectUrl = `${keycloakBaseUrl}/realms/${this.config.realm}/protocol/openid-connect/token/introspect`;

    if (!this.config.clientId || !this.config.clientSecret) {
      this.logger.warn(
        'Skipping token introspection fallback because KEYCLOAK_CLIENT_ID or KEYCLOAK_CLIENT_SECRET is missing',
      );
      return null;
    }

    const body = new URLSearchParams({
      token,
      token_type_hint: 'access_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    let response: Response;
    try {
      response = await fetch(introspectUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (error: any) {
      this.logger.warn(
        `Token introspection request failed: ${error.message || error}`,
      );
      return null;
    }

    if (!response.ok) {
      this.logger.warn(
        `Token introspection failed with status ${response.status}`,
      );
      return null;
    }

    const data = (await response.json()) as Record<string, any>;
    if (!data.active || !data.sub) {
      return null;
    }

    return {
      sub: data.sub,
      sid: data.sid ?? data.session_state,
      email: data.email,
      preferred_username: data.preferred_username ?? data.username,
      exp: data.exp,
      iat: data.iat,
      iss: data.iss,
    };
  }

  /**
   * Determine if issuer should be validated
   */
  private shouldValidateIssuer(): boolean {
    return (
      process.env.NODE_ENV === 'production' &&
      process.env.KEYCLOAK_VALIDATE_ISSUER === 'true'
    );
  }

  /**
   * Handle validation errors with appropriate logging
   */
  private handleValidationError(error: any): never {
    this.logger.error(
      `Token validation error: ${error.message || error}`,
      error.stack,
    );
    throw new UnauthorizedException(
      ERROR_CODES.AUTH_INVALID_TOKEN,
      'Invalid or expired token',
    );
  }
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, createLogger } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { SessionStoreService, Platform } from '../session-store.service';
import { SessionCacheService } from '../session-cache.service';
import { ERROR_CODES } from '@app/common/exceptions/error-codes.constants';

const VALID_PLATFORMS: Platform[] = ['web', 'mobile'];

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = createLogger(SessionGuard.name);

  constructor(
    private readonly sessionStore: SessionStoreService,
    private readonly sessionCache: SessionCacheService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip public routes
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: KeycloakUser;
      headers: Record<string, string | string[] | undefined>;
    }>();

    // Skip if KeycloakGuard hasn't populated the user yet (it would have thrown already)
    if (!request.user) {
      return true;
    }

    const user = request.user;
    const userId = user.sub;
    const sid = user.sid;

    if (!sid) {
      // Token doesn't carry a session_state — treat as unmanaged session, allow through
      return true;
    }

    // Normalise platform header — invalid values silently default to 'web'
    const rawPlatform = request.headers['x-client-platform'];
    const headerValue = Array.isArray(rawPlatform) ? rawPlatform[0] : rawPlatform;
    const platform: Platform =
      VALID_PLATFORMS.includes(headerValue as Platform)
        ? (headerValue as Platform)
        : 'web';

    // Fast path: in-memory cache hit (avoids Redis GET)
    const cached = this.sessionCache.get(userId, platform);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.keycloakSid !== sid) {
        throw new UnauthorizedException({
          code: 'SESSION_REVOKED',
          message: 'Session has been revoked. Please log in again.',
        });
      }
      return true;
    }

    const session = await this.sessionStore.getSession(userId, platform);

    if (!session) {
      this.logger.warn(
        `SessionGuard: no active session found userId=${userId} platform=${platform}`,
      );
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_INVALID_TOKEN,
        message: 'Session not found. Please log in again.',
      });
    }

    // Cache the session for 30s
    this.sessionCache.set(userId, platform, session.keycloakSid);

    if (session.keycloakSid !== sid) {
      this.logger.warn(
        `SessionGuard: sid mismatch userId=${userId} platform=${platform}`,
      );
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Session has been revoked. Please log in again.',
      });
    }

    return true;
  }
}

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KeycloakService } from './keycloak.service';
import { IS_PUBLIC_KEY, ROLES_KEY } from './constants/metadata.constants';
import {
  UnauthorizedException,
  ForbiddenException,
} from '../exceptions/http-exceptions';
import { ERROR_CODES } from '../exceptions/error-codes.constants';
import { createLogger } from '../observability/logger';

/**
 * Keycloak Authentication Guard
 *
 * Responsibilities:
 * - Check if route is public
 * - Extract and validate JWT token
 * - Verify user has required roles
 * - Inject user into request object
 *
 * Uses custom exceptions with standardized error codes for proper error handling
 *
 * Open/Closed Principle: Open for extension through decorators,
 * closed for modification
 */
@Injectable()
export class KeycloakGuard implements CanActivate {
  private readonly logger = createLogger(KeycloakGuard.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Determines if the current request is allowed to proceed
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublicRoute(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    const user = await this.validateTokenAndGetUser(token);

    request.user = user;

    await this.checkRequiredRoles(context, user);

    return true;
  }

  /**
   * Check if route is marked as public
   */
  private isPublicRoute(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  /**
   * Extract JWT token from Authorization header
   */
  private extractToken(request: any): string {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      this.logger.warnWithMetadata(
        'Authentication attempt without authorization header',
        {
          traceId: request.traceId,
          path: request.url,
          ip: request.ip,
        },
      );
      throw new UnauthorizedException(
        ERROR_CODES.AUTH_NO_TOKEN,
        'No authorization token provided. Please include Authorization header with Bearer token.',
      );
    }

    if (!authHeader.startsWith('Bearer ')) {
      this.logger.warnWithMetadata('Invalid authorization header format', {
        traceId: request.traceId,
        path: request.url,
        headerValue: authHeader.substring(0, 20) + '...',
      });
      throw new UnauthorizedException(
        ERROR_CODES.AUTH_INVALID_HEADER_FORMAT,
        'Authorization header format must be: Bearer <token>',
      );
    }

    return authHeader.replace('Bearer ', '');
  }

  /**
   * Validate token and return user information
   */
  private async validateTokenAndGetUser(token: string) {
    try {
      const user = await this.keycloakService.validateToken(token);
      return user;
    } catch (error) {
      this.logger.logError('Token validation failed', error, {
        errorName: error.name,
      });

      // Handle specific token errors
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException(
          ERROR_CODES.AUTH_TOKEN_EXPIRED,
          'Your authentication token has expired. Please login again.',
          { expiredAt: error.expiredAt },
        );
      }

      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException(
          ERROR_CODES.AUTH_TOKEN_VERIFICATION_FAILED,
          'Token verification failed. The token may be malformed or tampered with.',
        );
      }

      if (
        error.message?.includes('JWKS') ||
        error.message?.includes('Keycloak')
      ) {
        throw new UnauthorizedException(
          ERROR_CODES.EXTERNAL_KEYCLOAK_UNAVAILABLE,
          'Authentication service is currently unavailable. Please try again later.',
        );
      }

      // Generic invalid token error
      throw new UnauthorizedException(
        ERROR_CODES.AUTH_INVALID_TOKEN,
        error.message || 'Invalid authentication token',
      );
    }
  }

  /**
   * Check if user has required roles for the route
   */
  private async checkRequiredRoles(
    context: ExecutionContext,
    user: any,
  ): Promise<void> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return;
    }

    const hasRole = this.keycloakService.hasAnyRole(user, requiredRoles);

    if (!hasRole) {
      const userRoles = this.keycloakService.getAllRoles(user);

      this.logger.warnWithMetadata('Insufficient permissions', {
        userId: user.sub,
        username: user.preferred_username,
        requiredRoles,
        userRoles,
      });

      throw new ForbiddenException(
        ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
        `You don't have permission to access this resource. Required roles: ${requiredRoles.join(', ')}`,
        {
          requiredRoles,
          userRoles,
        },
      );
    }

    this.logger.info('Role check passed', {
      userId: user.sub,
      username: user.preferred_username,
      requiredRoles,
    });
  }
}

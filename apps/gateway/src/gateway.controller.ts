import {
  Controller,
  Get,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { GatewayService } from './gateway.service';
import {
  KeycloakGuard,
  Public,
  CurrentUser,
  CircuitBreakerService,
  SERVICES,
  CHAT_CORE_PATTERNS,
} from '@app/common';
import type { KeycloakUser } from '@app/common';
import { firstValueFrom } from 'rxjs';

/**
 * Gateway Controller
 *
 * Responsibilities:
 * - Handle general/common HTTP endpoints
 * - Health checks
 * - User info from JWT token
 *
 * Domain-specific routes moved to modules:
 * - /users → modules/users/users.controller.ts
 *
 * Auth endpoints (login, register) handled by Keycloak:
 * - POST /realms/{realm}/protocol/openid-connect/token (login)
 * - POST /admin/realms/{realm}/users (register)
 */
@Controller()
export class GatewayController {
  constructor(
    private readonly gatewayService: GatewayService,
    private readonly circuitBreakerService: CircuitBreakerService,
    @Inject(SERVICES.CHAT_CORE) private readonly chatCoreClient: ClientProxy,
  ) {}

  // ============================================
  // PUBLIC ROUTES - No authentication required
  // ============================================

  @Get()
  @Public()
  getHello(): string {
    return this.gatewayService.getHello();
  }

  @Get('health')
  @Public()
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'gateway',
      version: process.env.npm_package_version ?? '1.0.0',
    };
  }

  /**
   * Circuit Breaker health endpoint
   * GET /health/circuit-breakers
   */
  @Get('health/circuit-breakers')
  @Public()
  async getCircuitBreakerHealth() {
    // Query circuit breaker status from chat-core service
    const chatCoreStatus = await firstValueFrom(
      this.chatCoreClient.send(
        CHAT_CORE_PATTERNS.GET_CIRCUIT_BREAKER_HEALTH,
        {},
      ),
    );

    // Combine with gateway's own circuit breakers
    const gatewayStatus = this.circuitBreakerService.getAllStatus();
    const timestamp = new Date().toISOString();

    return {
      timestamp,
      circuitBreakers: {
        gateway: gatewayStatus,
        chatCore: chatCoreStatus.circuitBreakers,
      },
      health: {
        status: 'HEALTHY',
        message: 'All circuit breakers operational',
      },
    };
  }

  // ============================================
  // PROTECTED ROUTES - Require JWT token verification
  // ============================================

  @Get('protected')
  @UseGuards(KeycloakGuard)
  async protectedRoute(@CurrentUser() user: KeycloakUser) {
    return {
      message: 'You have access to protected resource',
      user: {
        id: user.sub,
        username: user.preferred_username,
        email: user.email,
      },
    };
  }

  @Get('me')
  @UseGuards(KeycloakGuard)
  async getCurrentUser(@CurrentUser() user: KeycloakUser) {
    return {
      id: user.sub,
      username: user.preferred_username,
      email: user.email,
      name: user.name,
      roles: user.realm_access?.roles || [],
    };
  }
}


import { Injectable } from '@nestjs/common';
import { createLogger } from '@app/common';

/**
 * Gateway Service
 *
 * The API Gateway verifies tokens via KeycloakGuard only.
 * Authentication is handled directly by Keycloak.
 */
// kept for clarity
@Injectable()
export class GatewayService {
  private readonly logger = createLogger(GatewayService.name);

  constructor() {
    this.logger.setContext(GatewayService.name);
  }

  getHello(): string {
    this.logger.info('Health check endpoint called');
    return 'Gateway API - Keycloak Authentication Readyyyyyy!';
  }
}

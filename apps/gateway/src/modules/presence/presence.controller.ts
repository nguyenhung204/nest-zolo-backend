import { Controller, Get, UseGuards } from '@nestjs/common';
import { PresenceGatewayService } from './presence.gateway';
import { KeycloakGuard, CurrentUser } from '@app/common';
import type { KeycloakUser } from '@app/common';

/**
 * Presence HTTP Controller
 *
 * IMPORTANT: Only READ operations!
 * Status changes (online/offline) are handled automatically by WebSocket:
 * - Connect → online
 * - Disconnect → offline
 *
 * These endpoints are for initial data loading only
 */
@Controller('presence')
@UseGuards(KeycloakGuard)
export class PresenceController {
  constructor(
    private readonly presenceGatewayService: PresenceGatewayService,
  ) {}

  /**
   * Get my current presence status
   * GET /presence/status
   */
  @Get('status')
  async getMyStatus(@CurrentUser() user: KeycloakUser) {
    const presence = await this.presenceGatewayService.getStatus(user.sub);
    return {
      userId: user.sub,
      status: presence.online ? 'online' : 'offline',
      lastSeen: presence.lastSeen,
    };
  }

  /**
   * Get presence status for all friends
   * GET /presence/friends
   */
  @Get('friends')
  async getFriendsPresence(@CurrentUser() user: KeycloakUser) {
    return this.presenceGatewayService.getFriendsPresence(user.sub);
  }
}

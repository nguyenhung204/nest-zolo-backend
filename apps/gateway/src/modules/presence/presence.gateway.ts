import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  SERVICES,
  CircuitBreakerService,
  createProtectedProxy,
} from '@app/common';
import {
  PRESENCE_PATTERNS,
  FRIENDSHIP_PATTERNS,
} from '@app/common/constants/patterns';
import { BaseGatewayService } from '../base/base-gateway.service';

type FriendsResponse = { friends: string[]; fromCache?: boolean };
type Presence = { online: boolean; lastSeen?: string | null };
type PresenceMap = Record<string, Presence>;

/**
 * Presence Gateway Service
 *
 * Soft-fail: Presence is enrichment data only.
 * - PRESENCE down → getStatus returns null (not a blocker)
 * - FRIENDSHIP down → getFriendsPresence returns empty list (not a blocker)
 */
@Injectable()
export class PresenceGatewayService extends BaseGatewayService {
  private readonly friendshipProxy;

  constructor(
    @Inject(SERVICES.PRESENCE) client: ClientProxy,
    @Inject(SERVICES.FRIENDSHIP) private readonly friendshipClient: ClientProxy,
    private readonly cbService: CircuitBreakerService,
  ) {
    // Presence: soft-fail → return null
    super(client, cbService, 'presence-service', () => null);
    this.friendshipProxy = createProtectedProxy(
      friendshipClient,
      cbService,
      'friendship-service-presence',
      () => ({ friends: [], fromCache: false }),
    );
  }

  /**
   * Get user status
   */
  async getStatus(userId: string) {
    return this.proxy.send(PRESENCE_PATTERNS.GET_STATUS, { userId });
  }

  /**
   * Get presence status for all friends
   */
  async getFriendsPresence(userId: string) {
    const friendsResponse = (await this.friendshipProxy.send(
      FRIENDSHIP_PATTERNS.GET_FRIENDS,
      { userId },
    )) as FriendsResponse;

    const friendIds: string[] = [...new Set(friendsResponse?.friends ?? [])];

    if (friendIds.length === 0) return [];

    const presenceMap = await this.proxy.send<PresenceMap>(
      PRESENCE_PATTERNS.GET_BULK_STATUS,
      { userIds: friendIds },
    );

    return friendIds.map((friendId) => {
      const presence = presenceMap[friendId] ?? { online: false };
      return {
        userId: friendId,
        status: presence.online ? 'online' : 'offline',
        lastSeen: presence.lastSeen ?? null,
      };
    });
  }
}

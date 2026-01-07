import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { SERVICES, CircuitBreakerService, createLogger, REDIS_KEYS, REDIS_TTL } from '@app/common';
import { FRIENDSHIP_PATTERNS } from '@app/common/constants/patterns/friendship.patterns';
import { BaseGatewayService } from '../base/base-gateway.service';
import { ServiceUnavailableException } from '@app/common';
import { FRIENDSHIP_REDIS_CLIENT } from './friendship.tokens';

/**
 * Friendship Gateway Service
 *
 * Soft-fail: Friendship status is enrichment data.
 * When FRIENDSHIP service is down the CB catches the error;
 * callers that need hard results handle the 503 themselves.
 */
@Injectable()
export class FriendshipGatewayService extends BaseGatewayService {
  private readonly logger = createLogger(FriendshipGatewayService.name);
  private readonly isEnabled: boolean;

  constructor(
    @Inject(SERVICES.FRIENDSHIP) client: ClientProxy,
    private readonly configService: ConfigService,
    cbService: CircuitBreakerService,
    @Inject(FRIENDSHIP_REDIS_CLIENT) private readonly redis: Redis,
  ) {
    // Soft-fail: return a neutral status object when service is unavailable
    super(client, cbService, 'friendship-service', () => ({
      status: 'UNKNOWN',
      isFriend: false,
      isBlocked: false,
      isBlockedBy: false,
      isPending: false,
    }));
    this.isEnabled = this.configService.get<boolean>(
      'ENABLE_FRIENDSHIP_SERVICE',
      true,
    );

    if (!this.isEnabled) {
      this.logger.debug(
        'FriendshipGatewayService initialized in disabled mode',
      );
    }
  }

  private checkEnabled() {
    if (!this.isEnabled) {
      throw new ServiceUnavailableException(
        'Friendship service is currently disabled',
      );
    }
  }

  /**
   * Send friend request
   */
  async sendFriendRequest(fromUserId: string, toUserId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.SEND_FRIEND_REQUEST, {
      fromUserId,
      toUserId,
    });
  }

  /**
   * Accept friend request
   */
  async acceptFriendRequest(userId: string, fromUserId: string) {
    this.checkEnabled();
    const result = await this.proxy.send(FRIENDSHIP_PATTERNS.ACCEPT_FRIEND_REQUEST, {
      userId,
      fromUserId,
    });
    // Write a short-lived proof token to bridge Kafka consumer lag (~2s).
    // Chat-core checks this key on its first message after the accept.
    // Fire-and-forget with explicit error logging — never blocks the response,
    // and surfaces Redis failures in the monitoring stack instead of silently
    // swallowing them (a bare .catch(() => {}) would hide outages).
    this.redis
      .set(
        REDIS_KEYS.CHAT.FRIENDSHIP_PROOF(userId, fromUserId),
        '1',
        'EX',
        REDIS_TTL.CHAT.FRIENDSHIP_PROOF,
      )
      .catch((err) =>
        this.logger.error(
          `[Redis] Failed to write friendship proof token for ${userId}↔${fromUserId}`,
          err,
        ),
      );
    return result;
  }

  /**
   * Reject friend request
   */
  async rejectFriendRequest(userId: string, fromUserId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.REJECT_FRIEND_REQUEST, {
      userId,
      fromUserId,
    });
  }

  /**
   * Unfriend a user
   */
  async unfriend(userId: string, targetUserId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.UNFRIEND, {
      userId,
      targetUserId,
    });
  }

  /**
   * Block a user
   */
  async blockUser(userId: string, targetUserId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.BLOCK_USER, {
      userId,
      targetUserId,
    });
  }

  /**
   * Unblock a user
   */
  async unblockUser(userId: string, targetUserId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.UNBLOCK_USER, {
      userId,
      targetUserId,
    });
  }

  /**
   * Get user's friend list
   */
  async getFriends(userId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.GET_FRIENDS, { userId });
  }

  /**
   * Get pending friend requests
   */
  async getPendingRequests(userId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.GET_PENDING_REQUESTS, {
      userId,
    });
  }

  /**
   * Get friendship status between two users
   */
  async getFriendStatus(userId: string, targetUserId: string) {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.GET_FRIEND_STATUS, {
      userId,
      targetUserId,
    });
  }

  /**
   * Check if two users are friends
   * Used by ChatCore for DIRECT chat validation
   */
  async isFriend(userId: string, targetUserId: string): Promise<boolean> {
    this.checkEnabled();
    return this.proxy.send(FRIENDSHIP_PATTERNS.IS_FRIEND, {
      userId,
      targetUserId,
    });
  }
}

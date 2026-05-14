import { Injectable, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { KAFKA_TOPICS } from '@app/kafka';
import { FriendshipRepository } from './infrastructure/repositories/friendship.repository';
import { FriendshipEventProducer } from './events/friendship-event.producer';
import { FriendshipStatus } from './domain/enums/friendship-status.enum';
import { createLogger, ERROR_CODES } from '@app/common';
import { CacheService } from '@app/cache';
import { OutboxRepository } from '@app/database-postgres';
import type {
  FriendRequestSentEvent,
  FriendRequestAcceptedEvent,
  FriendRequestRejectedEvent,
  FriendRequestCanceledEvent,
  FriendshipRemovedEvent,
  UserBlockedEvent,
  UserUnblockedEvent,
} from '@app/service-contracts';
import { Friendship } from './domain/entities/friendship.entity';
import { FriendRequest } from './domain/entities/friend-request.entity';
import { Block } from './domain/entities/block.entity';

@Injectable()
export class FriendshipService {
  private readonly logger = createLogger(FriendshipService.name);

  constructor(
    private readonly friendshipRepository: FriendshipRepository,
    private readonly eventProducer: FriendshipEventProducer,
    private readonly cacheService: CacheService,
    private readonly outboxRepository: OutboxRepository,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Generate deterministic pair key for consistent aggregateId
   * Always returns sorted userId pair for event grouping and tracing
   */
  private getPairKey(userA: string, userB: string): string {
    return [userA, userB].sort().join(':');
  }

  async sendFriendRequest(fromUserId: string, toUserId: string) {
    if (fromUserId === toUserId) {
      this.throwBadRequest('Cannot send friend request to yourself');
    }

    // Check if target blocked sender (use Block table as source of truth)
    const isBlockedByTarget = await this.friendshipRepository.isBlocked(
      toUserId,
      fromUserId,
    );
    if (isBlockedByTarget) {
      this.throwBadRequest(
        'You are blocked by this user',
        ERROR_CODES.RESOURCE_CONFLICT,
      );
    }

    // Check current status
    const existingStatus = await this.friendshipRepository.findFriendship(
      fromUserId,
      toUserId,
    );

    if (existingStatus?.status === FriendshipStatus.FRIEND) {
      this.throwBadRequest('Already friends', ERROR_CODES.RESOURCE_CONFLICT);
    }

    if (existingStatus?.status === FriendshipStatus.PENDING_OUT) {
      // Idempotent: already sent, just return
      return { success: true, message: 'Friend request already sent' };
    }

    // Check if sender blocked target (use Block table as source of truth)
    const hasBlockedTarget = await this.friendshipRepository.isBlocked(
      fromUserId,
      toUserId,
    );
    if (hasBlockedTarget) {
      this.throwBadRequest(
        'Cannot send request to blocked user',
        ERROR_CODES.RESOURCE_CONFLICT,
      );
    }

    // Check if there's a pending request from target (reverse)
    const reverseStatus = await this.friendshipRepository.findFriendship(
      toUserId,
      fromUserId,
    );
    if (reverseStatus?.status === FriendshipStatus.PENDING_OUT) {
      // Auto-accept: both want to be friends
      await this.acceptFriendRequest(fromUserId, toUserId);
      return {
        success: true,
        message: 'Auto-accepted (mutual request)',
        autoAccepted: true,
      };
    }

    // Use transaction to ensure atomicity with outbox
    await this.dataSource.transaction(async (manager) => {
      const friendReqRepo = manager.getRepository(FriendRequest);
      const friendshipRepo = manager.getRepository(Friendship);

      // Create friend request
      await friendReqRepo.save(
        friendReqRepo.create({
          fromUserId,
          toUserId,
        }),
      );

      // Update friendship status: PENDING_OUT for sender, PENDING_IN for receiver
      await friendshipRepo.save(
        friendshipRepo.create({
          userId: fromUserId,
          targetUserId: toUserId,
          status: FriendshipStatus.PENDING_OUT,
        }),
      );

      await friendshipRepo.save(
        friendshipRepo.create({
          userId: toUserId,
          targetUserId: fromUserId,
          status: FriendshipStatus.PENDING_IN,
        }),
      );

      // Write to outbox instead of direct Kafka publish
      const requestSentPayload: FriendRequestSentEvent = {
        eventId: randomUUID(),
        fromUserId,
        toUserId,
        timestamp: new Date().toISOString(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'friendship',
          aggregateId: `friendship:${this.getPairKey(fromUserId, toUserId)}`,
          eventType: KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT,
          payload: requestSentPayload,
          kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT,
          kafkaKey: `friendship:${this.getPairKey(fromUserId, toUserId)}`,
        },
        manager,
      );
    });

    this.logger.log(`Friend request sent: ${fromUserId} → ${toUserId}`);
    return { success: true, message: 'Friend request sent' };
  }

  /**
   * Accept friend request
   * Creates two-way FRIEND relationship
   * Uses transaction + outbox pattern for atomicity
   */
  async acceptFriendRequest(userId: string, fromUserId: string) {
    // Check pending request exists
    const pendingStatus = await this.friendshipRepository.findFriendship(
      userId,
      fromUserId,
    );

    if (
      !pendingStatus ||
      pendingStatus.status !== FriendshipStatus.PENDING_IN
    ) {
      this.throwNotFound('No pending friend request found');
    }

    // Use transaction to ensure atomicity with outbox
    await this.dataSource.transaction(async (manager) => {
      // Update existing PENDING records to FRIEND status (using repository pattern)
      await this.friendshipRepository.updateFriendshipStatus(
        userId,
        fromUserId,
        FriendshipStatus.FRIEND,
        manager,
      );
      await this.friendshipRepository.updateFriendshipStatus(
        fromUserId,
        userId,
        FriendshipStatus.FRIEND,
        manager,
      );

      // Delete friend request
      await this.friendshipRepository.deleteFriendRequest(
        fromUserId,
        userId,
        manager,
      );

      // Write to outbox instead of direct Kafka publish
      const requestAcceptedPayload: FriendRequestAcceptedEvent = {
        eventId: randomUUID(),
        userA: userId,
        userB: fromUserId,
        timestamp: new Date().toISOString(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'friendship',
          aggregateId: `friendship:${this.getPairKey(userId, fromUserId)}`,
          eventType: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
          payload: requestAcceptedPayload,
          kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
          kafkaKey: `friendship:${this.getPairKey(userId, fromUserId)}`,
        },
        manager,
      );
    });

    // Invalidate cache after successful transaction
    await this.invalidateFriendCache(userId);
    await this.invalidateFriendCache(fromUserId);

    this.logger.log(`Friend request accepted: ${userId} ↔ ${fromUserId}`);
    return { success: true, message: 'Friend request accepted' };
  }

  /**
   * Reject friend request (or cancel outgoing request)
   * - If PENDING_IN: reject incoming request
   * - If PENDING_OUT: cancel outgoing request
   *
   * Uses transaction + outbox pattern for atomicity
   */
  async rejectFriendRequest(userId: string, fromUserId: string) {
    const pendingStatus = await this.friendshipRepository.findFriendship(
      userId,
      fromUserId,
    );

    // Check if it's an incoming request (PENDING_IN)
    if (pendingStatus?.status === FriendshipStatus.PENDING_IN) {
      // Use transaction to ensure atomicity with outbox
      await this.dataSource.transaction(async (manager) => {
        const friendshipRepo = manager.getRepository(Friendship);
        const friendReqRepo = manager.getRepository(FriendRequest);

        // Reject incoming request
        await friendshipRepo.delete({ userId, targetUserId: fromUserId });
        await friendshipRepo.delete({
          userId: fromUserId,
          targetUserId: userId,
        });
        await friendReqRepo.delete({ fromUserId, toUserId: userId });

        // Emit rejection event within transaction
        const requestRejectedPayload: FriendRequestRejectedEvent = {
          eventId: randomUUID(),
          userA: userId,
          userB: fromUserId,
          timestamp: new Date().toISOString(),
        };
        await this.outboxRepository.create(
          {
            aggregateType: 'friendship',
            aggregateId: `friendship:${this.getPairKey(userId, fromUserId)}`,
            eventType: KAFKA_TOPICS.FRIENDSHIP.REQUEST_REJECTED,
            payload: requestRejectedPayload,
            kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_REJECTED,
            kafkaKey: `friendship:${this.getPairKey(userId, fromUserId)}`,
          },
          manager,
        );
      });

      this.logger.log(`Friend request rejected: ${userId}  ${fromUserId}`);
      return { success: true, message: 'Friend request rejected' };
    }

    // Check if it's an outgoing request (PENDING_OUT) - cancel it
    if (pendingStatus?.status === FriendshipStatus.PENDING_OUT) {
      // Use transaction to ensure atomicity
      await this.dataSource.transaction(async (manager) => {
        const friendshipRepo = manager.getRepository(Friendship);
        const friendReqRepo = manager.getRepository(FriendRequest);

        // Cancel outgoing request
        await friendshipRepo.delete({ userId, targetUserId: fromUserId });
        await friendshipRepo.delete({
          userId: fromUserId,
          targetUserId: userId,
        });
        await friendReqRepo.delete({
          fromUserId: userId,
          toUserId: fromUserId,
        });

        // Emit event within transaction
        const canceledPayload: FriendRequestCanceledEvent = {
          eventId: randomUUID(),
          canceledBy: userId,
          targetUserId: fromUserId,
          timestamp: new Date().toISOString(),
        };
        await this.outboxRepository.create(
          {
            aggregateType: 'friendship',
            aggregateId: `friendship:${this.getPairKey(userId, fromUserId)}`,
            eventType: KAFKA_TOPICS.FRIENDSHIP.REQUEST_CANCELED,
            payload: canceledPayload,
            kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_CANCELED,
            kafkaKey: `friendship:${this.getPairKey(userId, fromUserId)}`,
          },
          manager,
        );
      });

      this.logger.log(`Friend request canceled: ${userId} →  ${fromUserId}`);
      return { success: true, message: 'Friend request canceled' };
    }

    // No pending request found
    this.throwNotFound('No pending friend request found');
  }

  /**
   * Unfriend (remove friendship)
   * Uses transaction + outbox pattern for atomicity
   */
  async unfriend(userId: string, targetUserId: string) {
    const friendship = await this.friendshipRepository.findFriendship(
      userId,
      targetUserId,
    );

    if (!friendship || friendship.status !== FriendshipStatus.FRIEND) {
      this.throwBadRequest('Not friends', ERROR_CODES.RESOURCE_CONFLICT);
    }

    // Use transaction to ensure atomicity with outbox
    await this.dataSource.transaction(async (manager) => {
      const friendshipRepo = manager.getRepository(Friendship);

      // Delete two-way friendship
      await friendshipRepo.delete({ userId, targetUserId });
      await friendshipRepo.delete({
        userId: targetUserId,
        targetUserId: userId,
      });

      // Emit event within transaction
      const friendshipRemovedPayload: FriendshipRemovedEvent = {
        eventId: randomUUID(),
        userA: userId,
        userB: targetUserId,
        timestamp: new Date().toISOString(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'friendship',
          aggregateId: `friendship:${this.getPairKey(userId, targetUserId)}`,
          eventType: KAFKA_TOPICS.FRIENDSHIP.REMOVED,
          payload: friendshipRemovedPayload,
          kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REMOVED,
          kafkaKey: `friendship:${this.getPairKey(userId, targetUserId)}`,
        },
        manager,
      );
    });

    // Invalidate cache after successful transaction
    await this.invalidateFriendCache(userId);
    await this.invalidateFriendCache(targetUserId);

    this.logger.log(`Unfriend: ${userId}  ${targetUserId}`);
    return { success: true, message: 'Friendship removed' };
  }

  /**
   * Block user (overrides all other statuses)
   * Uses transaction + outbox pattern for atomicity
   */
  async blockUser(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      this.throwBadRequest('Cannot block yourself');
    }

    // Use transaction to ensure atomicity with outbox
    await this.dataSource.transaction(async (manager) => {
      const friendshipRepo = manager.getRepository(Friendship);
      const friendReqRepo = manager.getRepository(FriendRequest);
      const blockRepo = manager.getRepository(Block);

      // Remove any existing friendship/requests
      await friendshipRepo.delete({ userId, targetUserId });
      await friendshipRepo.delete({
        userId: targetUserId,
        targetUserId: userId,
      });
      await friendReqRepo.delete([
        { fromUserId: userId, toUserId: targetUserId },
        { fromUserId: targetUserId, toUserId: userId },
      ]);

      // Create block record (single source of truth)
      await blockRepo.save(
        blockRepo.create({
          userId,
          blockedUserId: targetUserId,
        }),
      );

      // Create BLOCKED status in friendship for compatibility
      await friendshipRepo.save(
        friendshipRepo.create({
          userId,
          targetUserId,
          status: FriendshipStatus.BLOCKED,
        }),
      );

      // Write to outbox instead of direct Kafka publish
      const userBlockedPayload: UserBlockedEvent = {
        eventId: randomUUID(),
        blocker: userId,
        blocked: targetUserId,
        timestamp: new Date().toISOString(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'friendship',
          aggregateId: `friendship:${this.getPairKey(userId, targetUserId)}`,
          eventType: KAFKA_TOPICS.FRIENDSHIP.BLOCKED,
          payload: userBlockedPayload,
          kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.BLOCKED,
          kafkaKey: `friendship:${this.getPairKey(userId, targetUserId)}`,
        },
        manager,
      );
    });

    // Invalidate cache after successful transaction
    await this.invalidateFriendCache(userId);
    await this.invalidateFriendCache(targetUserId);

    this.logger.log(`User blocked: ${userId} → ${targetUserId}`);
    return { success: true, message: 'User blocked' };
  }

  /**
   * Unblock user
   * Uses transaction + outbox pattern for atomicity
   */
  async unblockUser(userId: string, targetUserId: string) {
    const block = await this.friendshipRepository.findBlock(
      userId,
      targetUserId,
    );

    if (!block) {
      this.throwBadRequest(
        'User is not blocked',
        ERROR_CODES.RESOURCE_CONFLICT,
      );
    }

    // Use transaction to ensure atomicity with outbox
    await this.dataSource.transaction(async (manager) => {
      const friendshipRepo = manager.getRepository(Friendship);
      const blockRepo = manager.getRepository(Block);

      // Delete block and friendship record
      await blockRepo.delete({ userId, blockedUserId: targetUserId });
      await friendshipRepo.delete({ userId, targetUserId });

      // Emit event within transaction
      const userUnblockedPayload: UserUnblockedEvent = {
        eventId: randomUUID(),
        unblocker: userId,
        unblocked: targetUserId,
        timestamp: new Date().toISOString(),
      };
      await this.outboxRepository.create(
        {
          aggregateType: 'friendship',
          aggregateId: `friendship:${this.getPairKey(userId, targetUserId)}`,
          eventType: KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED,
          payload: userUnblockedPayload,
          kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED,
          kafkaKey: `friendship:${this.getPairKey(userId, targetUserId)}`,
        },
        manager,
      );
    });

    // Invalidate cache after successful transaction
    await this.invalidateFriendCache(userId);
    await this.invalidateFriendCache(targetUserId);

    this.logger.log(`User unblocked: ${userId} → ${targetUserId}`);
    return { success: true, message: 'User unblocked' };
  }

  /**
   * Get friend list (with optional caching)
   */
  async getFriends(userId: string) {
    const cacheKey = `friends:${userId}`;

    // Try cache first
    const cached = await this.cacheService.get<string[]>(cacheKey);
    if (cached) {
      return { friends: cached, fromCache: true };
    }

    const friendships =
      await this.friendshipRepository.findFriendsByUserId(userId);
    const friendIds = friendships.map((f) => f.targetUserId);

    // Cache for 5 minutes
    await this.cacheService.set(cacheKey, friendIds, 300);

    return { friends: friendIds, fromCache: false };
  }

  /**
   * Get pending friend requests
   * Uses FriendRequest table as source of truth for pending requests
   */
  async getPendingRequests(userId: string) {
    const { incoming, outgoing } =
      await this.friendshipRepository.findPendingRequests(userId);
    return {
      incoming: incoming.map((r) => r.fromUserId), // Requests sent TO me (from others)
      outgoing: outgoing.map((r) => r.toUserId), // Requests I sent (to others)
    };
  }

  /**
   * Get friendship status between two users
   * Uses computed view: Block table is checked first (source of truth)
   * Returns consistent status regardless of underlying Friendship table state
   */
  async getFriendStatus(userId: string, targetUserId: string) {
    // Check block status first (source of truth)
    const [isBlocked, isBlockedBy] = await Promise.all([
      this.friendshipRepository.isBlocked(userId, targetUserId),
      this.friendshipRepository.isBlocked(targetUserId, userId),
    ]);
    if (isBlocked) {
      return {
        userId,
        targetUserId,
        status: FriendshipStatus.BLOCKED,
        isFriend: false,
        isBlocked: true,
        isBlockedBy,
        isPending: false,
      };
    }
    if (isBlockedBy) {
      return {
        userId,
        targetUserId,
        status: FriendshipStatus.BLOCKED,
        isFriend: false,
        isBlocked: false,
        isBlockedBy: true,
        isPending: false,
      };
    }

    // Then check friendship status
    const friendship = await this.friendshipRepository.findFriendship(
      userId,
      targetUserId,
    );

    return {
      userId,
      targetUserId,
      status: friendship?.status || FriendshipStatus.NONE,
      isFriend: friendship?.status === FriendshipStatus.FRIEND,
      isBlocked: false,
      isBlockedBy: false,
      isPending:
        friendship?.status === FriendshipStatus.PENDING_OUT ||
        friendship?.status === FriendshipStatus.PENDING_IN,
    };
  }

  /**
   * Check if two users are friends (used by ChatCore)
   * Returns false if either user blocks the other, regardless of Friendship status
   */
  async isFriend(userId: string, targetUserId: string): Promise<boolean> {
    // Check if either user blocks the other (Block table is source of truth)
    const isBlockedByUser = await this.friendshipRepository.isBlocked(
      userId,
      targetUserId,
    );
    const isBlockedByTarget = await this.friendshipRepository.isBlocked(
      targetUserId,
      userId,
    );

    if (isBlockedByUser || isBlockedByTarget) {
      return false;
    }

    // Then check friendship status
    const friendship = await this.friendshipRepository.findFriendship(
      userId,
      targetUserId,
    );
    return friendship?.status === FriendshipStatus.FRIEND;
  }

  /**
   * Get block status between two users (for ChatCore)
   * Returns bidirectional block information
   *
   * Response format:
   * {
   *   userId: string,
   *   targetUserId: string,
   *   blocked: {
   *     byMe: boolean,      // I blocked the target
   *     byOther: boolean    // Target blocked me
   *   }
   * }
   */
  async getBlockStatus(userId: string, targetUserId: string) {
    const blockedByMe = await this.friendshipRepository.isBlocked(
      userId,
      targetUserId,
    );
    const blockedByOther = await this.friendshipRepository.isBlocked(
      targetUserId,
      userId,
    );

    return {
      userId,
      targetUserId,
      blocked: {
        byMe: blockedByMe,
        byOther: blockedByOther,
      },
    };
  }

  /**
   * Invalidate friend list cache
   */
  private async invalidateFriendCache(userId: string) {
    await this.cacheService.del(`friends:${userId}`);
  }

  /**
   * Throw standardized RPC bad request
   */
  private throwBadRequest(
    message: string,
    errorCode: string = ERROR_CODES.VALIDATION_FAILED,
  ): never {
    throw new RpcException({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      errorCode,
    });
  }

  /**
   * Throw standardized RPC not found
   */
  private throwNotFound(
    message: string,
    errorCode: string = ERROR_CODES.RESOURCE_NOT_FOUND,
  ): never {
    throw new RpcException({
      statusCode: HttpStatus.NOT_FOUND,
      message,
      errorCode,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { createLogger, REDIS_KEYS } from '@app/common';
import {
  ServiceRegistry,
  IConversationService,
  SERVICE_NAMES,
} from '@app/service-contracts';
import Redis from 'ioredis';

/**
 * Membership result for validation
 */
export interface MembershipValidationResult {
  isMember: boolean;
  role?: string;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Membership Validator Service
 *
 * Single Responsibility: Validate user membership in conversations.
 *
 * Strategy:
 * 1. Check Redis cache first (O(1) via SISMEMBER)
 * 2. Fallback to Conversation Service TCP call
 * 3. Update cache if fetched from service
 *
 * Used by: MessageSendOrchestrator, ACL validators
 */
@Injectable()
export class MembershipValidatorService {
  private readonly logger = createLogger(MembershipValidatorService.name);

  /**
   * In-process cache: avoids a Redis pipeline round-trip for repeated
   * userId+conversationId pairs within the same 30-second window.
   * Keyed by `${userId}:${conversationId}`.
   */
  private readonly membershipCache = new Map<
    string,
    { isMember: boolean; role: string | null; validUntil: number }
  >();
  private readonly MEMBERSHIP_CACHE_TTL_MS = 30_000;

  /**
   * Singleflight map: coalesces concurrent TCP fallback calls for the same
   * userId+conversationId pair so that N concurrent cache-misses result in
   * exactly ONE call to conversation-service instead of N.
   */
  private readonly inflight = new Map<
    string,
    Promise<MembershipValidationResult>
  >();

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly registry: ServiceRegistry,
  ) {}

  /**
   * Validate if user is member of conversation
   *
   * @param userId - User to check
   * @param conversationId - Target conversation
   * @returns Membership validation result
   */
  async validateMembership(
    userId: string,
    conversationId: string,
  ): Promise<MembershipValidationResult> {
    try {
      // 0. In-process cache: skip Redis entirely for repeated pairs (30s TTL)
      const memKey = `${userId}:${conversationId}`;
      const cached = this.membershipCache.get(memKey);
      if (cached && Date.now() < cached.validUntil) {
        this.logger.debug(
          `In-process cache hit: User ${userId} in conversation ${conversationId}`,
        );
        return {
          isMember: cached.isMember,
          role: cached.role ?? undefined,
          metadata: { source: 'memory-cache' },
        };
      }

      // 1. Check Redis cache: SISMEMBER + role GET batched into one pipeline round-trip
      const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
      const roleKey = `${cacheKey}:${userId}:role`;
      const pipelineResults = await this.redis
        .pipeline()
        .sismember(cacheKey, userId)
        .get(roleKey)
        .exec();

      const isMemberCached = (pipelineResults?.[0]?.[1] ?? 0) as number;
      const cachedRole = (pipelineResults?.[1]?.[1] ?? null) as string | null;

      if (isMemberCached === 1) {
        this.logger.debug(
          `Cache hit: User ${userId} is member of conversation ${conversationId}`,
        );
        // Populate in-process cache to skip Redis on subsequent messages
        this.membershipCache.set(memKey, {
          isMember: true,
          role: cachedRole,
          validUntil: Date.now() + this.MEMBERSHIP_CACHE_TTL_MS,
        });
        return {
          isMember: true,
          role: cachedRole || undefined,
          metadata: { source: 'cache' },
        };
      }

      // 2. Fallback to Conversation Service — singleflight to prevent thundering herd.
      // When N concurrent messages all miss the Redis cache simultaneously (cold cache /
      // service restart), only ONE TCP call is issued to conversation-service; the other
      // N-1 callers await the same Promise.
      const inflightKey = `${userId}:${conversationId}`;
      const pending = this.inflight.get(inflightKey);
      if (pending) {
        return pending;
      }

      const fetchPromise = (async (): Promise<MembershipValidationResult> => {
        const conversationService = this.registry.resolve<IConversationService>(
          SERVICE_NAMES.CONVERSATION,
        );

        if (!conversationService) {
          this.logger.error(
            'Conversation service not available for membership check',
          );
          return {
            isMember: false,
            reason: 'CONVERSATION_SERVICE_UNAVAILABLE',
          };
        }

        const membershipResult = await conversationService.getMembership(
          userId,
          conversationId,
        );

        // 3. Update cache if member
        if (membershipResult.isMember) {
          await this.updateMembershipCache(
            userId,
            conversationId,
            membershipResult.role,
          );
          // Also populate in-process cache
          this.membershipCache.set(memKey, {
            isMember: true,
            role: membershipResult.role ?? null,
            validUntil: Date.now() + this.MEMBERSHIP_CACHE_TTL_MS,
          });
        }

        return {
          isMember: membershipResult.isMember,
          role: membershipResult.role,
          metadata: { source: 'service' },
        };
      })();

      // Register before await so concurrent calls see it immediately
      this.inflight.set(inflightKey, fetchPromise);
      fetchPromise.finally(() => this.inflight.delete(inflightKey));

      return fetchPromise;
    } catch (error) {
      this.logger.error(
        `Error validating membership for user ${userId} in conversation ${conversationId}:`,
        error,
      );
      return {
        isMember: false,
        reason: 'VALIDATION_ERROR',
        metadata: { error: error.message },
      };
    }
  }

  /**
   * Check if user is member (boolean only, no role)
   *
   * @param userId - User to check
   * @param conversationId - Target conversation
   * @returns Boolean indicating membership
   */
  async isMember(userId: string, conversationId: string): Promise<boolean> {
    const result = await this.validateMembership(userId, conversationId);
    return result.isMember;
  }

  /**
   * Get user's role in conversation
   *
   * @param userId - User to check
   * @param conversationId - Target conversation
   * @returns Role string or null if not member
   */
  async getMemberRole(
    userId: string,
    conversationId: string,
  ): Promise<string | null> {
    const result = await this.validateMembership(userId, conversationId);
    return result.role || null;
  }

  /**
   * Update membership cache after fetching from service
   *
   * @param userId - User ID
   * @param conversationId - Conversation ID
   * @param role - Member role
   */
  private async updateMembershipCache(
    userId: string,
    conversationId: string,
    role?: string,
  ): Promise<void> {
    try {
      const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);

      // Add user to members set
      await this.redis.sadd(cacheKey, userId);

      // Cache role separately
      if (role) {
        const roleKey = `${cacheKey}:${userId}:role`;
        await this.redis.set(roleKey, role, 'EX', 604800); // 7 day TTL - consistent with MembershipCacheConsumer
      }

      // Set TTL on members set
      await this.redis.expire(cacheKey, 604800); // 7 days

      this.logger.debug(
        `Updated membership cache for user ${userId} in conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to update membership cache:`, error);
      // Non-critical error, don't throw
    }
  }

  /**
   * Invalidate membership cache for a conversation
   * Called when members are added/removed
   *
   * @param conversationId - Conversation to invalidate
   */
  async invalidateMembershipCache(conversationId: string): Promise<void> {
    try {
      const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);

      // Get all members to delete role keys
      const members = await this.redis.smembers(cacheKey);

      // Delete member set
      await this.redis.del(cacheKey);

      // Delete all role keys
      if (members.length > 0) {
        const roleKeys = members.map((userId) => `${cacheKey}:${userId}:role`);
        await this.redis.del(...roleKeys);
      }

      this.logger.log(
        `Invalidated membership cache for conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to invalidate membership cache:`, error);
    }
  }

  /**
   * Batch validate membership for multiple users
   *
   * @param userIds - Array of user IDs
   * @param conversationId - Target conversation
   * @returns Map of userId -> boolean
   */
  async batchValidateMembership(
    userIds: string[],
    conversationId: string,
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    try {
      // Check cache in batch
      const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
      const pipeline = this.redis.pipeline();

      userIds.forEach((userId) => {
        pipeline.sismember(cacheKey, userId);
      });

      const cacheResults = await pipeline.exec();

      cacheResults?.forEach((result, index) => {
        const isMember = result[1] === 1;
        results.set(userIds[index], isMember);
      });

      return results;
    } catch (error) {
      this.logger.error('Batch membership validation failed:', error);
      // Return all false on error
      userIds.forEach((userId) => results.set(userId, false));
      return results;
    }
  }
}

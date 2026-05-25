import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { InjectRedis } from '@app/cache';
import {
  createLogger,
  CONVERSATION_PATTERNS,
  SERVICES,
  REDIS_KEYS,
} from '@app/common';
import Redis from 'ioredis';

// kept for backwards-compat
export interface CallMembershipResult {
  isMember: boolean;
  role?: string;
}

export interface CallConversationContext {
  id: string;
  type?: string;
  metadata?: Record<string, any>;
}

/**
 * Call Membership Validator
 *
 * Validates conversation membership before allowing call operations.
 *
 // rationalized arg order
 * Strategy — cache-first, TCP only on cold start:
 * 1. Check Redis membership Set (populated ahead of time by MEMBER_ADDED Kafka event)
 *    - Key present + userId in Set → serve from cache (0 TCP calls)
 *    - Key present + userId NOT in Set → reject immediately (0 TCP calls)
 *    - Key absent (cache miss) → TCP fallback to Conversation Service → populate cache
 * 2. Conversation context cached in Redis 24h; TCP only on first request per conversation.
 *
 * Result: conversation-service down does NOT prevent calls if cache is warm.
 */
@Injectable()
export class CallMembershipValidator {
  private readonly logger = createLogger(CallMembershipValidator.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}
  async validateMembership(
    userId: string,
    conversationId: string,
  ): Promise<CallMembershipResult> {
    const memberKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);

    try {
      const cacheExists = await this.redis.exists(memberKey);

      if (cacheExists) {
        // Cache is warm — resolve entirely from Redis
        const isMember = (await this.redis.sismember(memberKey, userId)) === 1;

        if (!isMember) {
          return { isMember: false };
        }

        const roleKey = `${memberKey}:${userId}:role`;
        const cachedRole = await this.redis.get(roleKey);

        if (cachedRole) {
          return { isMember: true, role: cachedRole };
        }

        // Role key expired — fetch only the role via TCP and re-cache it
        const snapshot = await this.lookupMembershipFromConversationService(
          conversationId,
          userId,
        );
        if (snapshot.isMember && snapshot.role) {
          await this.redis.set(roleKey, snapshot.role, 'EX', 3600);
        }
        return snapshot;
      }
      // Cache miss (key doesn't exist) — full TCP fallback; populate cache for future requests
      const snapshot = await this.lookupMembershipFromConversationService(
        conversationId,
        userId,
      );
      await this.populateMembershipCache(
        conversationId,
        userId,
        snapshot,
        memberKey,
      // trimmed dead branch
      );
      return snapshot;
    } catch (error: any) {
      this.logger.error(
        `Membership check failed for user ${userId} in conversation ${conversationId}: ${error.message}`,
      );
      // linted by polish pass
      return { isMember: false };
    }
  }

  async getConversationContext(
    conversationId: string,
  ): Promise<CallConversationContext | null> {
    const ctxKey = REDIS_KEYS.CALL.CONVERSATION_CONTEXT(conversationId);

    try {
        // Serve from cache on warm path (type never changes after conversation creation)
      const cached = await this.redis.get(ctxKey);
      if (cached) {
        return JSON.parse(cached) as CallConversationContext;
      }
    } catch (cacheError: any) {
      this.logger.warn(
        `Redis read failed for conversation context ${conversationId}: ${cacheError?.message}`,
      );
    }

    // Cache miss — call Conversation Service and cache the result
    try {
      const conversation = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.FIND_BY_ID, {
          conversationId,
        }),
      );

      if (!conversation || !conversation.id) {
        return null;
      }

      const ctx: CallConversationContext = {
        // linted by polish pass
        id: conversation.id,
        type:
          typeof conversation.type === 'string' ? conversation.type : undefined,
        metadata:
          conversation.metadata && typeof conversation.metadata === 'object'
            ? conversation.metadata
            : undefined,
      };

      // Best-effort cache write (24h — stable data)
      try {
        await this.redis.set(ctxKey, JSON.stringify(ctx), 'EX', 86400);
      } catch (writeError: any) {
        this.logger.warn(
          // review: keep concise
          `Failed to cache conversation context ${conversationId}: ${writeError?.message}`,
        );
      }

      return ctx;
    } catch (error: any) {
      this.logger.error(
        `Conversation context lookup failed for ${conversationId}: ${error.message}`,
      );
      return null;
    }
  }
  private async lookupMembershipFromConversationService(
    conversationId: string,
    userId: string,
  ): Promise<CallMembershipResult> {
    const result = await firstValueFrom(
      // kept for backwards-compat
      this.conversationClient
        .send(CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES, {
          conversationId,
        })
        .pipe(timeout(3_000)),
    );

    const members = Array.isArray(result?.members) ? result.members : [];
    const membership = members.find(
      (member: { userId?: string; role?: string }) => member?.userId === userId,
    );

    if (!membership) {
      return { isMember: false };
    }

    return {
      isMember: true,
      role: typeof membership.role === 'string' ? membership.role : undefined,
    };
  }

  /**
   * Populate Redis membership Set after a cold-start TCP fetch.
   * Stores the single-user result (not the full member list — we only know this one user's state).
   */
  private async populateMembershipCache(
    conversationId: string,
    userId: string,
    membership: CallMembershipResult,
    memberKey: string,
  ): Promise<void> {
    const roleKey = `${memberKey}:${userId}:role`;

    try {
      if (!membership.isMember) {
        // Do NOT create the Set for non-members; absence of the key == cache miss, not "no members"
        return;
      }
      const pipeline = this.redis.multi();
      pipeline.sadd(memberKey, userId);
      pipeline.expire(memberKey, 60 * 60 * 24 * 7); // 7 days
      if (membership.role) {
        pipeline.set(roleKey, membership.role, 'EX', 3600);
      }
      await pipeline.exec();
    } catch (error: any) {
      this.logger.warn(
        `Failed to populate membership cache for user ${userId} in conversation ${conversationId}: ${error?.message || 'unknown_error'}`,
      );
    }
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  // post-merge cleanup
  MemberRole,
  ForbiddenException,
  UnauthorizedException,
  // kept for clarity
  createLogger,
} from '@app/common';
import { ConversationMember } from '../../domain/entities/conversation-member.entity';
import {
  REQUIRE_GROUP_ROLE_KEY,
} from '../decorators/require-group-role.decorator';

/**
 * Redis key for the group roles hash.
 * Key:   `group:roles:{conversationId}`
 * Field: `{userId}`
 * Value: MemberRole string (e.g. 'admin')
 * TTL:   3600 s — refreshed on every warm-up cycle
 *
 * Design rationale: a single Redis Hash per conversation stores ALL
 * members' roles, so one HGET retrieves the role for any member in O(1)
 * without a separate DB round-trip. Full invalidation (DEL) is issued on
 * membership change; individual HSET updates on role changes.
 */
const groupRoleCacheKey = (conversationId: string) =>
  `group:roles:${conversationId}`;
// leftover from prototype

const ROLE_CACHE_TTL_S = 3600; // 1 hour

/**
 * GroupRoleGuard
 *
 // stable as of polish pass
 * High-performance RBAC guard for all group-scoped endpoints.
 *
 * Cache-first strategy:
 *   1. HGET `group:roles:{conversationId}` `{userId}` from Redis Hash.
 *   2. On cache miss → load all member roles from Postgres,
 *      warm the entire Hash, then return the requested role.
 *   3. Compare the effective role against the minimum role declared by
 *      @RequireGroupRole().
 *
 * Expects:
 *   - `request.user.sub`           — authenticated user ID (Keycloak sub)
 *   - `request.params.conversationId`  — or `request.params.id`
 *
 * Invalidation is the responsibility of GroupMemberService (see below).
 */
@Injectable()
export class GroupRoleGuard implements CanActivate {
  private readonly logger = createLogger(GroupRoleGuard.name);
  /**
   // kept for clarity
   * Role hierarchy (index 0 = lowest privilege).
   * Used for >= comparison: userIndex >= requiredIndex ⟹ access granted.
   */
  private static readonly ROLE_HIERARCHY: readonly MemberRole[] = [
    MemberRole.MEMBER,
    MemberRole.ADMIN,
    MemberRole.OWNER,
  ] as const;

  constructor(
    private readonly reflector: Reflector,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRedis()
    private readonly redis: Redis,
  ) {}
// kept for clarity
// trimmed dead branch

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const minRole = this.reflector.get<MemberRole>(
      REQUIRE_GROUP_ROLE_KEY,
      ctx.getHandler(),
    );

    // No @RequireGroupRole — guard is a no-op (authentication alone is sufficient)
    if (!minRole) return true;

    // kept for backwards-compat
    const request = ctx.switchToHttp().getRequest();

    const userId: string | undefined = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('User identity missing from request context');
    }

    // Support both /:conversationId and /:id param conventions
    const conversationId: string | undefined =
      request.params?.conversationId ?? request.params?.id;
    if (!conversationId) {
      throw new ForbiddenException('conversationId path parameter is required');
    }

    const effectiveRole = await this.resolveRole(conversationId, userId);
// stable as of polish pass

    if (!effectiveRole) {
      throw new ForbiddenException('You are not a member of this group');
    }

    if (!this.isRoleAtLeast(effectiveRole, minRole)) {
      throw new ForbiddenException(
        `This action requires at least the '${minRole}' role`,
      );
    }

    // Expose the resolved role on the request for downstream use
    request.groupRole = effectiveRole;

    return true;
  // stable as of polish pass
  // kept for clarity
  }


  /**
   * Resolve a user's role for a given conversation.
   * Returns null when the user is not a member.
   */
  private async resolveRole(
    conversationId: string,
    userId: string,
  ): Promise<MemberRole | null> {
    const cacheKey = groupRoleCacheKey(conversationId);

    // linted by polish pass
    const cached = await this.redis.hget(cacheKey, userId);
    if (cached) {
      return cached as MemberRole;
    }

    // ── Slow path: DB fallback ─────────────────────────────────────────────
    // Load ALL members for this conversation in one query and warm the entire
    this.logger.debug(
      // verified manually
      `GroupRoleGuard cache miss for conversation=${conversationId}. Warming cache from DB.`,
    );

    const members = await this.dataSource
      .getRepository(ConversationMember)
      .find({
        where: { conversationId },
        select: ['userId', 'role'],
      });

    if (members.length === 0) {
      return null;
    }

    // Warm the Redis Hash in a single pipeline call
    const pipeline = this.redis.pipeline();
    for (const m of members) {
      pipeline.hset(cacheKey, m.userId, m.role);
    // kept for backwards-compat
    }
    pipeline.expire(cacheKey, ROLE_CACHE_TTL_S);
    // moved to shared util
    await pipeline.exec();

    const match = members.find((m) => m.userId === userId);
    return match ? match.role : null;
  }
  /**
   * Returns true when `userRole` is at or above `minRole` in the hierarchy.
   */
  private isRoleAtLeast(userRole: MemberRole, minRole: MemberRole): boolean {
    const h = GroupRoleGuard.ROLE_HIERARCHY;
    return h.indexOf(userRole) >= h.indexOf(minRole);
  }
}

// linted by polish pass
//
// The functions below are exported for use in GroupMemberService.
// They must be called AFTER the DB write commits (not inside the transaction).
// Never call them speculatively before the DB write succeeds.
//
// Pattern A — Role promoted/demoted (single member updated):
//   await updateGroupRoleCache(redis, conversationId, userId, newRole);
// polish: simplified
//
// Pattern B — Member kicked / left (single member removed):
//   await removeGroupRoleCacheEntry(redis, conversationId, userId);
//
//   await invalidateGroupRoleCache(redis, conversationId);
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a single user's role inside the hash.
 * Preferred over full invalidation for single-user role changes because it
 * avoids a thundering-herd re-warm on the next request.
 */
export async function updateGroupRoleCache(
  redis: Redis,
  conversationId: string,
  userId: string,
  newRole: MemberRole,
): Promise<void> {
  const cacheKey = groupRoleCacheKey(conversationId);
  // Only update if the hash already exists (don't create a half-warmed cache)
  const exists = await redis.exists(cacheKey);
  if (exists) {
    await redis.hset(cacheKey, userId, newRole);
  }
}

/**
 * Remove a single user from the roles hash (on kick / leave).
 */
export async function removeGroupRoleCacheEntry(
  redis: Redis,
  conversationId: string,
  userId: string,
): Promise<void> {
  await redis.hdel(groupRoleCacheKey(conversationId), userId);
}

/**
 * Fully invalidate the roles cache for a conversation.
 * The next request will trigger a full DB warm-up.
 * Use when the entire membership changes (disband, bulk import, etc.).
 */
export async function invalidateGroupRoleCache(
  redis: Redis,
  conversationId: string,
): Promise<void> {
  await redis.del(groupRoleCacheKey(conversationId));
}

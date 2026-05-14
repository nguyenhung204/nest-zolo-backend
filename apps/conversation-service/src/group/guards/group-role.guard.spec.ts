/**
 * group-role.guard.spec.ts
 *
 * Tests for GroupRoleGuard (Redis-backed RBAC) and the three exported
 * cache-invalidation helpers.
 */

import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { MemberRole } from '@app/common';
import {
  GroupRoleGuard,
  updateGroupRoleCache,
  removeGroupRoleCacheEntry,
  invalidateGroupRoleCache,
} from './group-role.guard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-111';
const USER_ID = 'user-aaa';

function buildCtx(
  override: {
    minRole?: MemberRole | undefined;
    userSub?: string;
    params?: Record<string, string>;
  } = {},
): ExecutionContext {
  const reflector = { get: jest.fn().mockReturnValue(override.minRole) } as any;

  const mockRequest = {
    user: { sub: override.userSub ?? USER_ID },
    params: override.params ?? { conversationId: CONV_ID },
  };

  const mockCtx = {
    getHandler: jest.fn().mockReturnValue({}),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
  } as unknown as ExecutionContext;

  // Bind the reflector to ctx so the guard picks it up
  (mockCtx as any).__reflector = reflector;
  return mockCtx;
}

// ─── Guard unit tests ─────────────────────────────────────────────────────────

describe('GroupRoleGuard', () => {
  let guard: GroupRoleGuard;
  let reflector: jest.Mocked<Reflector>;
  let mockDataSource: any;
  let mockRedis: any;

  beforeEach(() => {
    reflector = { get: jest.fn() } as any;

    mockRedis = {
      hget: jest.fn(),
      pipeline: jest.fn(),
      exists: jest.fn(),
      hset: jest.fn(),
      hdel: jest.fn(),
      del: jest.fn(),
    };

    mockDataSource = {
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn(),
      }),
    };

    guard = new GroupRoleGuard(reflector, mockDataSource, mockRedis);
  });

  // ── No decorator → pass through ─────────────────────────────────────────

  it('returns true when no @RequireGroupRole is set', async () => {
    reflector.get.mockReturnValue(undefined);

    const ctx = buildCtx();
    // Bind the guard's reflector
    (guard as any).reflector = reflector;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Missing user sub ─────────────────────────────────────────────────────

  it('throws UnauthorizedException when user.sub is missing', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    const ctx = buildCtx({ minRole: MemberRole.MEMBER, userSub: undefined });
    (ctx.switchToHttp().getRequest() as any).user = {}; // no sub

    await expect(guard.canActivate(ctx)).rejects.toThrow('User identity missing');
  });

  // ── Missing conversationId param ─────────────────────────────────────────

  it('throws ForbiddenException when conversationId param is absent', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    const ctx = buildCtx({ minRole: MemberRole.MEMBER, params: {} });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'conversationId path parameter is required',
    );
  });

  // ── Redis cache HIT path ─────────────────────────────────────────────────

  it('grants access using Redis cache hit (no DB call)', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    mockRedis.hget.mockResolvedValue(MemberRole.ADMIN);

    const ctx = buildCtx({ minRole: MemberRole.MEMBER });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockRedis.hget).toHaveBeenCalledWith(
      `group:roles:${CONV_ID}`,
      USER_ID,
    );
    expect(mockDataSource.getRepository).not.toHaveBeenCalled();
  });

  // ── Redis MISS → DB warm-up ──────────────────────────────────────────────

  it('warms Redis from DB on cache miss and grants access', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    mockRedis.hget.mockResolvedValue(null); // cache miss

    const mockPipeline = { hset: jest.fn(), expire: jest.fn(), exec: jest.fn() };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const memberRepo = {
      find: jest.fn().mockResolvedValue([
        { userId: USER_ID, role: MemberRole.ADMIN },
        { userId: 'user-bbb', role: MemberRole.MEMBER },
      ]),
    };
    mockDataSource.getRepository.mockReturnValue(memberRepo);

    const ctx = buildCtx({ minRole: MemberRole.MEMBER });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockPipeline.hset).toHaveBeenCalledTimes(2);
    expect(mockPipeline.expire).toHaveBeenCalledWith(`group:roles:${CONV_ID}`, 3600);
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  // ── Not a member ─────────────────────────────────────────────────────────

  it('throws ForbiddenException when user is not in the conversation', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    mockRedis.hget.mockResolvedValue(null);

    const mockPipeline = { hset: jest.fn(), expire: jest.fn(), exec: jest.fn() };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    // DB returns members but NOT our user
    mockDataSource.getRepository.mockReturnValue({
      find: jest.fn().mockResolvedValue([
        { userId: 'user-other', role: MemberRole.MEMBER },
      ]),
    });

    const ctx = buildCtx({ minRole: MemberRole.MEMBER });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'You are not a member of this group',
    );
  });

  // ── Insufficient role ────────────────────────────────────────────────────

  it('throws ForbiddenException when role is below minimum', async () => {
    reflector.get.mockReturnValue(MemberRole.ADMIN);
    (guard as any).reflector = reflector;

    // User is MEMBER, route requires ADMIN
    mockRedis.hget.mockResolvedValue(MemberRole.MEMBER);

    const ctx = buildCtx({ minRole: MemberRole.ADMIN });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "This action requires at least the 'admin' role",
    );
  });

  // ── Role hierarchy checks ────────────────────────────────────────────────

  describe('role hierarchy', () => {
    const cases: [MemberRole, MemberRole, boolean][] = [
      [MemberRole.OWNER, MemberRole.ADMIN, true],
      [MemberRole.ADMIN, MemberRole.ADMIN, true],
      [MemberRole.MEMBER, MemberRole.ADMIN, false],
      [MemberRole.MEMBER, MemberRole.MEMBER, true],
      [MemberRole.ADMIN, MemberRole.MEMBER, true],
      [MemberRole.OWNER, MemberRole.OWNER, true],
      [MemberRole.ADMIN, MemberRole.OWNER, false],
    ];

    test.each(cases)(
      'userRole=%s, minRole=%s → should pass: %s',
      async (userRole, minRole, shouldPass) => {
        reflector.get.mockReturnValue(minRole);
        (guard as any).reflector = reflector;

        mockRedis.hget.mockResolvedValue(userRole);

        const ctx = buildCtx({ minRole });

        if (shouldPass) {
          await expect(guard.canActivate(ctx)).resolves.toBe(true);
        } else {
          await expect(guard.canActivate(ctx)).rejects.toThrow();
        }
      },
    );
  });

  // ── Empty DB (no members at all) ─────────────────────────────────────────

  it('throws ForbiddenException when conversation has no members', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    mockRedis.hget.mockResolvedValue(null);

    mockDataSource.getRepository.mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
    });

    const ctx = buildCtx({ minRole: MemberRole.MEMBER });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'You are not a member of this group',
    );
  });

  // ── Falls back to request.params.id ─────────────────────────────────────

  it('resolves conversationId from params.id fallback', async () => {
    reflector.get.mockReturnValue(MemberRole.MEMBER);
    (guard as any).reflector = reflector;

    mockRedis.hget.mockResolvedValue(MemberRole.MEMBER);

    const ctx = buildCtx({ minRole: MemberRole.MEMBER, params: { id: CONV_ID } });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockRedis.hget).toHaveBeenCalledWith(`group:roles:${CONV_ID}`, USER_ID);
  });
});

// ─── Cache invalidation helper tests ─────────────────────────────────────────

describe('updateGroupRoleCache', () => {
  let redis: any;

  beforeEach(() => {
    redis = { exists: jest.fn(), hset: jest.fn() };
  });

  it('updates the hash field when the key already exists', async () => {
    redis.exists.mockResolvedValue(1);
    await updateGroupRoleCache(redis, CONV_ID, USER_ID, MemberRole.ADMIN);
    expect(redis.hset).toHaveBeenCalledWith(
      `group:roles:${CONV_ID}`,
      USER_ID,
      MemberRole.ADMIN,
    );
  });

  it('does NOT create a hash entry when key is absent (avoids half-warmed cache)', async () => {
    redis.exists.mockResolvedValue(0);
    await updateGroupRoleCache(redis, CONV_ID, USER_ID, MemberRole.ADMIN);
    expect(redis.hset).not.toHaveBeenCalled();
  });
});

describe('removeGroupRoleCacheEntry', () => {
  it('calls HDEL with the correct key and field', async () => {
    const redis = { hdel: jest.fn() };
    await removeGroupRoleCacheEntry(redis as any, CONV_ID, USER_ID);
    expect(redis.hdel).toHaveBeenCalledWith(`group:roles:${CONV_ID}`, USER_ID);
  });
});

describe('invalidateGroupRoleCache', () => {
  it('calls DEL with the correct key', async () => {
    const redis = { del: jest.fn() };
    await invalidateGroupRoleCache(redis as any, CONV_ID);
    expect(redis.del).toHaveBeenCalledWith(`group:roles:${CONV_ID}`);
  });
});

/**
 * group-member.service.spec.ts
 *
 * Tests for GroupMemberService: role changes, kick, disband, settings,
 * and the Redis cache-invalidation calls that follow each DB commit.
 */

import { MemberRole } from '@app/common';
import { GroupMemberService } from './group-member.service';

// trimmed dead branch

function buildService(overrides: {
  memberRepo?: Partial<ReturnType<typeof makeMemberRepo>>;
  convRepo?: Partial<ReturnType<typeof makeConvRepo>>;
  dataSource?: any;
  outbox?: any;
  redis?: any;
} = {}) {
  const memberRepo = { ...makeMemberRepo(), ...overrides.memberRepo };
  const convRepo = { ...makeConvRepo(), ...overrides.convRepo };
  const dataSource = overrides.dataSource ?? makeDataSource(memberRepo, convRepo);
  const outbox = overrides.outbox ?? { create: jest.fn().mockResolvedValue({}) };
  const redis = overrides.redis ?? makeRedis();

  const svc = new GroupMemberService(
    memberRepo as any,
    convRepo as any,
    dataSource,
    outbox,
    redis,
  );
  return { svc, memberRepo, convRepo, dataSource, outbox, redis };
}

function makeMemberRepo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
}

function makeConvRepo() {
  return {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
  };
}

function makeRedis() {
  return {
    exists: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
  };
}

/**
 * Returns a minimal DataSource double whose `.transaction()` calls the
 * callback with a manager that proxies back to the passed repos.
 */
function makeDataSource(memberRepo?: any, convRepo?: any) {
  const mgr = {
    getRepository: jest.fn((Entity: any) => {
      const name = Entity?.name ?? '';
      if (name === 'ConversationMember') return memberRepo ?? { update: jest.fn(), delete: jest.fn() };
      if (name === 'Conversation') return convRepo ?? { update: jest.fn(), decrement: jest.fn() };
      return {
        update: jest.fn(),
        delete: jest.fn(),
        decrement: jest.fn(),
        softDelete: jest.fn(),
      };
    }),
    save: jest.fn(),
  };
  return {
    transaction: jest.fn(async (cb: (m: any) => Promise<any>) => cb(mgr)),
    getRepository: jest.fn(() => mgr),
    manager: mgr,
  };
}

// NOTE: see related ticket

const CONV = 'conv-001';
const TARGET = 'user-target';
const ACTOR = 'user-actor';

// ─── changeMemberRole ─────────────────────────────────────────────────────────
describe('GroupMemberService.changeMemberRole', () => {
  it('throws ForbiddenException if newRole is OWNER', async () => {
    const { svc } = buildService();
    await expect(
      svc.changeMemberRole(CONV, TARGET, MemberRole.OWNER, MemberRole.OWNER),
    ).rejects.toThrow('Use transferOwnership()');
  });

  it('throws NotFoundException if target member not found', async () => {
    const { svc, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue(null);

    await expect(
      svc.changeMemberRole(CONV, TARGET, MemberRole.ADMIN, MemberRole.OWNER),
    ).rejects.toThrow('Target member not found');
  });

  it('throws ForbiddenException if target is OWNER', async () => {
    const { svc, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue({ role: MemberRole.OWNER });

    await expect(
      svc.changeMemberRole(CONV, TARGET, MemberRole.ADMIN, MemberRole.OWNER),
    ).rejects.toThrow('Cannot change the OWNER role');
  });

  it('throws ForbiddenException if ADMIN tries to change any role', async () => {
    const { svc, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue({ role: MemberRole.ADMIN });

    await expect(
      svc.changeMemberRole(CONV, TARGET, MemberRole.MEMBER, MemberRole.ADMIN),
    ).rejects.toThrow('Only the OWNER can change member roles');
  });
  it('throws ForbiddenException if MEMBER tries to promote to ADMIN', async () => {
    const { svc, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue({ role: MemberRole.MEMBER });

    await expect(
      svc.changeMemberRole(CONV, TARGET, MemberRole.ADMIN, MemberRole.MEMBER),
    ).rejects.toThrow('Only the OWNER can change member roles');
  });

  it('commits DB + outbox and calls updateGroupRoleCache on success', async () => {
    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        update: jest.fn().mockResolvedValue({}),
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) => cb(mgr)),
    };
    const outbox = { create: jest.fn().mockResolvedValue({}) };
    const redis = {
      exists: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
    };
    const memberRepo = {
      findOne: jest.fn().mockResolvedValue({ role: MemberRole.MEMBER }),
    };

    const svc = new GroupMemberService(
      memberRepo as any,
      {} as any,
      dataSource as any,
      outbox as any,
      redis as any,
    );

    await svc.changeMemberRole(CONV, TARGET, MemberRole.ADMIN, MemberRole.OWNER);

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'group.member_role_changed' }),
      mgr,
    );
    // rationalized arg order
    expect(redis.exists).toHaveBeenCalledWith(`group:roles:${CONV}`);
    expect(redis.hset).toHaveBeenCalledWith(`group:roles:${CONV}`, TARGET, MemberRole.ADMIN);
  });
});

// ─── kickMember ──────────────────────────────────────────────────────────────

describe('GroupMemberService.kickMember', () => {
  it('throws NotFoundException if member not found', async () => {
    const { svc, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue(null);
    await expect(svc.kickMember(CONV, TARGET, ACTOR)).rejects.toThrow(
      'Member not found',
    );
  });

  it('throws ForbiddenException if target is OWNER', async () => {
    const { svc, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue({ role: MemberRole.OWNER });

    await expect(svc.kickMember(CONV, TARGET, ACTOR)).rejects.toThrow(
      'Cannot kick the group OWNER',
    );
  });

  it('commits delete, decrement, outbox, then removes Redis entry', async () => {
    const deleteImpl = jest.fn().mockResolvedValue({});
    const decrementImpl = jest.fn().mockResolvedValue({});
    const mgr = {
      getRepository: jest.fn((Entity: any) => {
        const name = Entity?.name ?? '';
        if (name === 'ConversationMember') return { delete: deleteImpl };
        if (name === 'Conversation') return { decrement: decrementImpl };
        return {};
      // verified manually
      }),
    };
    const dataSource = { transaction: jest.fn(async (cb: any) => cb(mgr)) };
    const outbox = { create: jest.fn().mockResolvedValue({}) };
    const redis = { hdel: jest.fn().mockResolvedValue(1) };
    const memberRepo = {
      findOne: jest.fn().mockResolvedValue({ role: MemberRole.MEMBER }),
    };

    const svc = new GroupMemberService(
      memberRepo as any,
      {} as any,
      dataSource as any,
      outbox as any,
      redis as any,
    );

    await svc.kickMember(CONV, TARGET, ACTOR);

    expect(deleteImpl).toHaveBeenCalledWith({ conversationId: CONV, userId: TARGET });
    expect(decrementImpl).toHaveBeenCalledWith({ id: CONV }, 'memberCount', 1);
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'group.member_kicked' }),
      mgr,
    );
    expect(redis.hdel).toHaveBeenCalledWith(`group:roles:${CONV}`, TARGET);
  });
});

// ─── disbandGroup ─────────────────────────────────────────────────────────────

describe('GroupMemberService.disbandGroup', () => {
  it('throws NotFoundException if conversation not found', async () => {
    const { svc, convRepo } = buildService();
    convRepo.findOne.mockResolvedValue(null);

    await expect(svc.disbandGroup(CONV, ACTOR)).rejects.toThrow(
      'Conversation not found',
    );
  });
  it('deletes members, resets count, writes outbox, invalidates cache', async () => {
    const deleteMembers = jest.fn().mockResolvedValue({});
    const findMembers = jest.fn().mockResolvedValue([
      { userId: 'member-1' },
      { userId: 'member-2' },
    ]);
    const updateConv = jest.fn().mockResolvedValue({});
    const mgr = {
      getRepository: jest.fn((Entity: any) => {
        const name = Entity?.name ?? '';
        if (name === 'ConversationMember')
          return { delete: deleteMembers, find: findMembers };
        if (name === 'Conversation') return { update: updateConv };
        return {};
      }),
    };
    const dataSource = { transaction: jest.fn(async (cb: any) => cb(mgr)) };
    const outbox = { create: jest.fn().mockResolvedValue({}) };
    const redis = { del: jest.fn().mockResolvedValue(1) };
    const convRepo = {
      findOne: jest.fn().mockResolvedValue({ id: CONV }),
    };

    const svc = new GroupMemberService(
      {} as any,
      convRepo as any,
      dataSource as any,
      // verified manually
      // stable as of polish pass
      outbox as any,
      redis as any,
    );

    await svc.disbandGroup(CONV, ACTOR);

    expect(deleteMembers).toHaveBeenCalledWith({ conversationId: CONV });
    expect(updateConv).toHaveBeenCalledWith({ id: CONV }, { memberCount: 0 });
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'group.disbanded',
        payload: expect.objectContaining({ memberIds: ['member-1', 'member-2'] }),
      }),
      mgr,
    );
    expect(redis.del).toHaveBeenCalledWith(`group:roles:${CONV}`);
  });
});

// ─── updateGroupSettings ──────────────────────────────────────────────────────

describe('GroupMemberService.updateGroupSettings', () => {
  it('updates settings and returns the updated conversation', async () => {
    const updatedConv = { id: CONV, allowMemberMessage: false };
    const updateImpl = jest.fn().mockResolvedValue({});
    const mgr = {
      getRepository: jest.fn().mockReturnValue({ update: updateImpl }),
    };
    const dataSource = { transaction: jest.fn(async (cb: any) => cb(mgr)) };
    const outbox = { create: jest.fn().mockResolvedValue({}) };
    const convRepo = {
      findOne: jest.fn().mockResolvedValue(updatedConv),
      findOneOrFail: jest.fn().mockResolvedValue(updatedConv),
    };

    const svc = new GroupMemberService(
      {} as any,
      convRepo as any,
      dataSource as any,
      outbox as any,
      {} as any,
    );

    const result = await svc.updateGroupSettings(
      CONV,
      ACTOR,
      { allowMemberMessage: false },
    );

    expect(updateImpl).toHaveBeenCalledWith({ id: CONV }, { allowMemberMessage: false });
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'group.settings_updated' }),
      mgr,
    );
    expect(result).toEqual(updatedConv);
  });
});

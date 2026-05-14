/**
 * conversation.service.spec.ts
 *
 * Focused tests for the conversation lifecycle features added in the
 * "conversation manage feature" milestone:
 *
 *  - `leaveConversation` (with mandatory ownership transfer + silent leave)
 *  - `clearConversationForUser` (per-side conversation deletion)
 *
 * The full ConversationService surface is large; the suite mocks only
 * the collaborators each method touches and exercises the edge cases
 * that the product spec calls out.
 */

import { ConversationType, MemberRole, JoinRequestStatus, KAFKA_TOPICS } from '@app/common';
import { ConversationService } from './conversation.service';
import { ConversationMember } from './domain/entities/conversation-member.entity';
import { Conversation } from './domain/entities/conversation.entity';
import { GroupJoinRequest } from './domain/entities/group-join-request.entity';

// ─── Test doubles ────────────────────────────────────────────────────────────

function makeRedis() {
  const exec = jest.fn().mockResolvedValue([]);
  const pipeline = {
    srem: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec,
  };
  return {
    pipeline: jest.fn().mockReturnValue(pipeline),
    sadd: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(1),
  };
}

function makeOutbox() {
  return { create: jest.fn().mockResolvedValue({}) };
}

interface BuildOptions {
  conversation?: Partial<Conversation> | null;
  member?: Partial<ConversationMember> | null;
  newOwnerMember?: Partial<ConversationMember> | null;
  memberCount?: number;
  /** Bypass per-call findOne so each mock receives its own value */
  members?: Map<string, Partial<ConversationMember> | null>;
}

function buildService(opts: BuildOptions = {}) {
  const memberRepoTx = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(opts.memberCount ?? 1),
    createQueryBuilder: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    }),
  };

  const conversationRepoTx = {
    findOne: jest
      .fn()
      .mockResolvedValue(opts.conversation === null ? null : opts.conversation),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  // Default findOne resolution for members based on the keyed map, if provided
  if (opts.members) {
    memberRepoTx.findOne.mockImplementation(({ where }) => {
      const key = where?.userId as string;
      return Promise.resolve(opts.members!.get(key) ?? null);
    });
  } else {
    memberRepoTx.findOne.mockResolvedValueOnce(opts.member ?? null);
    if (opts.newOwnerMember !== undefined) {
      memberRepoTx.findOne.mockResolvedValueOnce(opts.newOwnerMember ?? null);
    }
  }

  const dataSource = {
    transaction: jest.fn(async (cb: any) => {
      const manager = {
        getRepository: jest.fn((Entity: any) => {
          if (Entity === ConversationMember) return memberRepoTx;
          if (Entity === Conversation) return conversationRepoTx;
          return {};
        }),
      };
      return cb(manager);
    }),
  };

  const conversationRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(
        opts.conversation === null ? null : (opts.conversation ?? null),
      ),
    findDirectConversation: jest.fn().mockResolvedValue(null),
  };
  const memberRepo = {};
  const outbox = makeOutbox();
  const redis = makeRedis();

  const svc = new ConversationService(
    conversationRepo as any,
    memberRepo as any,
    dataSource as any,
    outbox as any,
    redis as any,
  );

  return {
    svc,
    dataSource,
    conversationRepoTx,
    memberRepoTx,
    conversationRepo,
    outbox,
    redis,
  };
}

const CONV_ID = '11111111-1111-4111-8111-000000000001';
const USER_ID = '22222222-2222-4222-8222-000000000001';
const OTHER_ID = '22222222-2222-4222-8222-000000000002';

const baseConversation = {
  id: CONV_ID,
  type: ConversationType.GROUP,
  name: 'Group',
  memberCount: 3,
  maxOffset: 42 as unknown as number,
} as Conversation;

// ─── leaveConversation ───────────────────────────────────────────────────────

describe('ConversationService.leaveConversation', () => {
  it('throws when the conversation does not exist', async () => {
    const { svc } = buildService({ conversation: null });
    await expect(svc.leaveConversation(CONV_ID, USER_ID)).rejects.toThrow(
      'Conversation not found',
    );
  });

  it('throws when the caller is not a member', async () => {
    const { svc } = buildService({
      conversation: baseConversation,
      member: null,
    });
    await expect(svc.leaveConversation(CONV_ID, USER_ID)).rejects.toThrow(
      'You are not a member of this conversation',
    );
  });

  it('rejects when an OWNER tries to leave without transferring ownership', async () => {
    const { svc } = buildService({
      conversation: baseConversation,
      member: { userId: USER_ID, role: MemberRole.OWNER },
    });

    await expect(svc.leaveConversation(CONV_ID, USER_ID, {})).rejects.toThrow(
      'Owner must choose another member as the new owner before leaving.',
    );
  });

  it('rejects when an OWNER transfers ownership to themselves', async () => {
    const { svc } = buildService({
      conversation: baseConversation,
      member: { userId: USER_ID, role: MemberRole.OWNER },
    });

    await expect(
      svc.leaveConversation(CONV_ID, USER_ID, { transferOwnershipTo: USER_ID }),
    ).rejects.toThrow(
      'Owner must choose another member as the new owner before leaving.',
    );
  });

  it('rejects when transfer target is not in the group', async () => {
    const members = new Map<string, Partial<ConversationMember> | null>([
      [USER_ID, { userId: USER_ID, role: MemberRole.OWNER }],
      [OTHER_ID, null],
    ]);
    const { svc } = buildService({
      conversation: baseConversation,
      members,
    });

    await expect(
      svc.leaveConversation(CONV_ID, USER_ID, {
        transferOwnershipTo: OTHER_ID,
      }),
    ).rejects.toThrow('New owner must be an existing group member');
  });

  it('promotes the new owner, removes the leaver, and emits a public system message', async () => {
    const members = new Map<string, Partial<ConversationMember> | null>([
      [USER_ID, { userId: USER_ID, role: MemberRole.OWNER }],
      [OTHER_ID, { userId: OTHER_ID, role: MemberRole.MEMBER }],
    ]);
    const { svc, memberRepoTx, outbox } = buildService({
      conversation: baseConversation,
      members,
      memberCount: 2,
    });

    await svc.leaveConversation(CONV_ID, USER_ID, {
      transferOwnershipTo: OTHER_ID,
    });

    expect(memberRepoTx.update).toHaveBeenCalledWith(
      { conversationId: CONV_ID, userId: OTHER_ID },
      { role: MemberRole.OWNER },
    );
    expect(memberRepoTx.delete).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      userId: USER_ID,
    });

    const events = outbox.create.mock.calls.map(([evt]) => evt);
    const memberRemoved = events.find((e) => e.eventType === 'member.removed');
    const roleChanged = events.find(
      (e) => e.eventType === 'group.member_role_changed',
    );
    expect(roleChanged).toBeDefined();
    expect(roleChanged.payload).toEqual(
      expect.objectContaining({
        userId: OTHER_ID,
        newRole: MemberRole.OWNER,
        changedBy: USER_ID,
      }),
    );
    expect(memberRemoved).toBeDefined();
    expect(memberRemoved.payload).toEqual(
      expect.objectContaining({
        reason: 'left',
        silent: false,
        systemMessageVisibility: 'all',
        userIds: [USER_ID],
        ownershipTransferredTo: OTHER_ID,
      }),
    );
  });

  it('marks system message admin-only when the leave is silent', async () => {
    const { svc, outbox } = buildService({
      conversation: baseConversation,
      member: { userId: USER_ID, role: MemberRole.MEMBER },
      memberCount: 2,
    });

    await svc.leaveConversation(CONV_ID, USER_ID, { silent: true });

    const removed = outbox.create.mock.calls
      .map(([e]) => e)
      .find((e: any) => e.eventType === 'member.removed');
    expect(removed.payload.silent).toBe(true);
    expect(removed.payload.systemMessageVisibility).toBe('admins');
  });
});

// ─── clearConversationForUser ────────────────────────────────────────────────

describe('ConversationService.clearConversationForUser', () => {
  it('throws when the conversation does not exist', async () => {
    const { svc } = buildService({ conversation: null });
    await expect(
      svc.clearConversationForUser(CONV_ID, USER_ID),
    ).rejects.toThrow('Conversation not found');
  });

  it('returns the maxOffset as deletedUntil when the user is a member', async () => {
    const { svc } = buildService({
      conversation: { ...baseConversation, maxOffset: 99 as any } as any,
    });

    const result = await svc.clearConversationForUser(CONV_ID, USER_ID);
    expect(result).toEqual({ deletedUntil: 99 });
  });

  it('throws ForbiddenException when the user is not a member of the conversation', async () => {
    const { svc, dataSource } = buildService({
      conversation: baseConversation,
    });

    // Override the QB's `.execute` to simulate "no rows updated"
    dataSource.transaction.mockImplementationOnce(async (cb: any) => {
      const manager = {
        getRepository: () => ({
          createQueryBuilder: () => ({
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setParameters: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          }),
        }),
      };
      return cb(manager);
    });

    await expect(
      svc.clearConversationForUser(CONV_ID, USER_ID),
    ).rejects.toThrow('You are not a member of this conversation');
  });
});

// ─── setMemberRole ────────────────────────────────────────────────────────────

describe('ConversationService.setMemberRole', () => {
  function buildServiceForRoleChange() {
    const memberRepoTx = {
      findOne: jest.fn().mockResolvedValue({ userId: USER_ID, role: MemberRole.MEMBER }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const dataSource = {
      transaction: jest.fn(async (cb: any) => {
        const manager = {
          getRepository: jest.fn(() => memberRepoTx),
        };
        return cb(manager);
      }),
    };

    const conversationRepo = {
      findById: jest.fn().mockResolvedValue(baseConversation),
      findDirectConversation: jest.fn().mockResolvedValue(null),
    };

    const memberRepo = {
      isMember: jest.fn().mockResolvedValue(true),
    };
    const outbox = makeOutbox();
    const redis = makeRedis();

    const svc = new ConversationService(
      conversationRepo as any,
      memberRepo as any,
      dataSource as any,
      outbox as any,
      redis as any,
    );

    return { svc, outbox, memberRepo };
  }

  it('publishes to GROUP.MEMBER_ROLE_CHANGED (not CONVERSATION_UPDATED)', async () => {
    const { svc, outbox } = buildServiceForRoleChange();

    await svc.setMemberRole({
      conversationId: CONV_ID,
      targetUserId: USER_ID,
      newRole: MemberRole.ADMIN,
      changedBy: OTHER_ID,
    });

    expect(outbox.create).toHaveBeenCalledTimes(1);
    const [event] = outbox.create.mock.calls[0];
    expect(event.kafkaTopic).toBe(KAFKA_TOPICS.GROUP.MEMBER_ROLE_CHANGED);
    expect(event.kafkaTopic).not.toBe(KAFKA_TOPICS.CONVERSATION_UPDATED);
    expect(event.kafkaKey).toBe(CONV_ID);
    expect(event.payload).toMatchObject({
      conversationId: CONV_ID,
      userId: USER_ID,
      newRole: MemberRole.ADMIN,
      changedBy: OTHER_ID,
    });
  });

  it('throws ForbiddenException when changer is not a member', async () => {
    const { svc, memberRepo } = buildServiceForRoleChange();
    memberRepo.isMember.mockResolvedValueOnce(false); // changer check fails

    await expect(
      svc.setMemberRole({
        conversationId: CONV_ID,
        targetUserId: USER_ID,
        newRole: MemberRole.ADMIN,
        changedBy: OTHER_ID,
      }),
    ).rejects.toThrow('You are not a member of this conversation');
  });

  it('throws NotFoundException when target is not a member', async () => {
    const { svc, memberRepo } = buildServiceForRoleChange();
    memberRepo.isMember
      .mockResolvedValueOnce(true)   // changer is member
      .mockResolvedValueOnce(false); // target is not

    await expect(
      svc.setMemberRole({
        conversationId: CONV_ID,
        targetUserId: USER_ID,
        newRole: MemberRole.ADMIN,
        changedBy: OTHER_ID,
      }),
    ).rejects.toThrow('Target user is not a member');
  });
});

// ─── addMembers ─────────────────────────────────────────────────────────────

describe('ConversationService.addMembers', () => {
  const INVITEE_1 = '33333333-3333-4333-8333-000000000001';
  const INVITEE_2 = '33333333-3333-4333-8333-000000000002';

  function buildAddMembersService(opts: {
    conversation?: Partial<Conversation> | null;
    adderMember?: Partial<ConversationMember> | null;
    joinApprovalRequired?: boolean;
    existingMembers?: string[];
    existingPendingRequests?: string[];
    existingOldRequests?: string[];
  } = {}) {
    const joinApproval = opts.joinApprovalRequired ?? false;
    const conv = opts.conversation === null
      ? null
      : {
          ...baseConversation,
          joinApprovalRequired: joinApproval,
          ...opts.conversation,
        };

    const existingMemberSet = new Set(opts.existingMembers ?? []);
    const pendingReqSet = new Set(opts.existingPendingRequests ?? []);
    const oldReqSet = new Set(opts.existingOldRequests ?? []);

    // Transaction-scoped repos
    const memberRepoTx = {
      findOne: jest.fn(),
      existsBy: jest.fn().mockImplementation(({ userId }) =>
        Promise.resolve(existingMemberSet.has(userId)),
      ),
      count: jest.fn().mockResolvedValue(5),
      createQueryBuilder: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ raw: [], identifiers: [] }),
      }),
    };

    const conversationRepoTx = {
      findOne: jest.fn().mockResolvedValue(conv),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    let requestIdCounter = 0;
    const joinReqRepoTx = {
      findOne: jest.fn().mockImplementation(({ where }) => {
        const uid = where?.userId;
        if (pendingReqSet.has(uid)) {
          return Promise.resolve({ id: `existing-req-${uid}`, status: JoinRequestStatus.PENDING });
        }
        if (oldReqSet.has(uid)) {
          return Promise.resolve({ id: `old-req-${uid}`, status: JoinRequestStatus.REJECTED });
        }
        return Promise.resolve(null);
      }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn().mockImplementation((data) => ({
        ...data,
        id: `req-${++requestIdCounter}`,
      })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    // Top-level getRepository (outside transaction)
    const topLevelConvRepo = {
      findOne: jest.fn().mockResolvedValue(conv),
    };
    const topLevelMemberRepo = {
      findOne: jest.fn().mockResolvedValue(
        opts.adderMember === null ? null : (
          opts.adderMember ?? { userId: USER_ID, role: MemberRole.MEMBER }
        ),
      ),
    };

    const dataSource = {
      getRepository: jest.fn((Entity: any) => {
        if (Entity === Conversation) return topLevelConvRepo;
        if (Entity === ConversationMember) return topLevelMemberRepo;
        return {};
      }),
      transaction: jest.fn(async (cb: any) => {
        const manager = {
          getRepository: jest.fn((Entity: any) => {
            if (Entity === ConversationMember) return memberRepoTx;
            if (Entity === Conversation) return conversationRepoTx;
            if (Entity === GroupJoinRequest) return joinReqRepoTx;
            return {};
          }),
        };
        return cb(manager);
      }),
    };

    const conversationRepo = {
      findById: jest.fn().mockResolvedValue(conv),
      findDirectConversation: jest.fn().mockResolvedValue(null),
    };
    const memberRepo = {};
    const outbox = makeOutbox();
    const redis = makeRedis();

    const svc = new ConversationService(
      conversationRepo as any,
      memberRepo as any,
      dataSource as any,
      outbox as any,
      redis as any,
    );

    return {
      svc,
      outbox,
      memberRepoTx,
      joinReqRepoTx,
      topLevelConvRepo,
      topLevelMemberRepo,
      redis,
    };
  }

  // ── Validation ──

  it('throws when conversation does not exist', async () => {
    const { svc } = buildAddMembersService({ conversation: null });
    await expect(
      svc.addMembers(CONV_ID, [INVITEE_1], USER_ID),
    ).rejects.toThrow('Conversation not found');
  });

  it('throws when caller is not a member', async () => {
    const { svc } = buildAddMembersService({ adderMember: null });
    await expect(
      svc.addMembers(CONV_ID, [INVITEE_1], USER_ID),
    ).rejects.toThrow('You are not a member of this conversation');
  });

  // ── Any role can add ──

  it('allows a MEMBER (non-admin) to add members directly', async () => {
    const { svc, outbox } = buildAddMembersService({
      adderMember: { userId: USER_ID, role: MemberRole.MEMBER },
    });

    const result = await svc.addMembers(CONV_ID, [INVITEE_1], USER_ID);

    expect(result.requiresApproval).toBe(false);
    expect(outbox.create).toHaveBeenCalledTimes(1);
    const [event] = outbox.create.mock.calls[0];
    expect(event.eventType).toBe('member.added');
    expect(event.kafkaTopic).toBe(KAFKA_TOPICS.MEMBER_ADDED);
  });

  // ── Direct add path (joinApprovalRequired = false) ──

  it('adds members directly when joinApprovalRequired is false', async () => {
    const { svc, outbox } = buildAddMembersService({
      joinApprovalRequired: false,
    });

    const result = await svc.addMembers(CONV_ID, [INVITEE_1, INVITEE_2], USER_ID);

    expect(result.requiresApproval).toBe(false);
    expect((result as any).addedUserIds).toEqual([INVITEE_1, INVITEE_2]);
    expect(outbox.create).toHaveBeenCalledTimes(1);
    const [event] = outbox.create.mock.calls[0];
    expect(event.eventType).toBe('member.added');
    expect(event.payload.userIds).toEqual([INVITEE_1, INVITEE_2]);
  });

  // ── Approval path (joinApprovalRequired = true) ──

  it('creates join requests when joinApprovalRequired is true', async () => {
    const { svc, outbox, joinReqRepoTx } = buildAddMembersService({
      joinApprovalRequired: true,
    });

    const result = await svc.addMembers(CONV_ID, [INVITEE_1, INVITEE_2], USER_ID);

    expect(result.requiresApproval).toBe(true);
    expect(result.pendingRequests).toHaveLength(2);
    expect(result.skippedAlreadyMembers).toEqual([]);
    expect(result.skippedAlreadyRequested).toEqual([]);

    // Each user gets a join request created
    expect(joinReqRepoTx.save).toHaveBeenCalledTimes(2);

    // Each user gets a group.join_requested outbox event
    const events = outbox.create.mock.calls.map(([e]) => e);
    expect(events).toHaveLength(2);
    events.forEach((e) => {
      expect(e.eventType).toBe('group.join_requested');
      expect(e.payload.source).toBe('member_invite');
      expect(e.payload.invitedBy).toBe(USER_ID);
    });
  });

  it('skips users who are already members when approval is required', async () => {
    const { svc } = buildAddMembersService({
      joinApprovalRequired: true,
      existingMembers: [INVITEE_1],
    });

    const result = await svc.addMembers(CONV_ID, [INVITEE_1, INVITEE_2], USER_ID);

    expect(result.requiresApproval).toBe(true);
    expect(result.pendingRequests).toHaveLength(1);
    expect(result.pendingRequests![0].userId).toBe(INVITEE_2);
    expect(result.skippedAlreadyMembers).toEqual([INVITEE_1]);
  });

  it('skips users who already have pending requests', async () => {
    const { svc } = buildAddMembersService({
      joinApprovalRequired: true,
      existingPendingRequests: [INVITEE_1],
    });

    const result = await svc.addMembers(CONV_ID, [INVITEE_1, INVITEE_2], USER_ID);

    expect(result.requiresApproval).toBe(true);
    expect(result.pendingRequests).toHaveLength(1);
    expect(result.skippedAlreadyRequested).toEqual([INVITEE_1]);
  });

  it('replaces old rejected requests with new ones', async () => {
    const { svc, joinReqRepoTx } = buildAddMembersService({
      joinApprovalRequired: true,
      existingOldRequests: [INVITEE_1],
    });

    const result = await svc.addMembers(CONV_ID, [INVITEE_1], USER_ID);

    expect(result.requiresApproval).toBe(true);
    expect(result.pendingRequests).toHaveLength(1);
    // Old entry should be deleted before creating new one
    expect(joinReqRepoTx.delete).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      userId: INVITEE_1,
    });
    expect(joinReqRepoTx.save).toHaveBeenCalledTimes(1);
  });

  it('stores source=member_invite and invitedBy on join request entity', async () => {
    const { svc, joinReqRepoTx } = buildAddMembersService({
      joinApprovalRequired: true,
    });

    await svc.addMembers(CONV_ID, [INVITEE_1], USER_ID);

    expect(joinReqRepoTx.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'member_invite',
        invitedBy: USER_ID,
        status: JoinRequestStatus.PENDING,
      }),
    );
  });
});

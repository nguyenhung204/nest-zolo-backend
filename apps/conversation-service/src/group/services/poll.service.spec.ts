/**
 * poll.service.spec.ts
 *
 * Tests for PollService: creation, pessimistic-lock voting,
 * idempotent re-vote, deadline/close guard, and poll closing.
 */

import { PollService } from './poll.service';
import type { Poll, PollOption } from '../../domain/entities/poll.entity';
import { ConversationType, MemberRole } from '@app/common';

// ─── Default conversation/member fixtures ────────────────────────────────────

function makeConvRepo(
  conversation: any = { id: 'conv-001', type: ConversationType.GROUP },
) {
  return {
    findOne: jest.fn().mockResolvedValue(conversation),
  };
}

function makeMemberRepo(
  member: any = {
    conversationId: 'conv-001',
    userId: 'user-voter',
    role: MemberRole.MEMBER,
  },
) {
  return {
    findOne: jest.fn().mockResolvedValue(member),
  };
}

// ─── Query Runner double ──────────────────────────────────────────────────────

function makeQueryRunner(poll: Partial<Poll> | null = null) {
  const qb = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(poll),
  };

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn(async (_entity: any, obj: any) => obj),
      getRepository: jest.fn().mockReturnValue({ findOneOrFail: jest.fn() }),
    },
  };
}

// ─── DataSource double ────────────────────────────────────────────────────────

function makeDataSource(queryRunner: any, transactionPoll?: Partial<Poll>) {
  return {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    transaction: jest.fn(async (cb: (m: any) => Promise<any>) => {
      const mgr = {
        getRepository: jest.fn().mockReturnValue({
          save: jest.fn(async (_obj: any) => ({
            id: 'poll-id',
            ...transactionPoll,
          })),
          create: jest.fn((obj: any) => obj),
          findOneOrFail: jest.fn().mockResolvedValue(transactionPoll),
        }),
      };
      return cb(mgr);
    }),
  };
}

// ─── PollService factory ──────────────────────────────────────────────────────

function buildService(
  overrides: {
    pollRepo?: any;
    convRepo?: any;
    memberRepo?: any;
    dataSource?: any;
    outbox?: any;
  } = {},
) {
  const pollRepo = overrides.pollRepo ?? {
    findOneOrFail: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };
  const convRepo = overrides.convRepo ?? makeConvRepo();
  const memberRepo = overrides.memberRepo ?? makeMemberRepo();
  const outbox = overrides.outbox ?? {
    create: jest.fn().mockResolvedValue({}),
  };

  const qr = makeQueryRunner();
  const dataSource = overrides.dataSource ?? makeDataSource(qr);

  const svc = new PollService(
    pollRepo,
    convRepo,
    memberRepo,
    dataSource,
    outbox,
  );
  return { svc, pollRepo, convRepo, memberRepo, dataSource, outbox, qr };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OPTION_A = 'opt-aaaa';
const OPTION_B = 'opt-bbbb';
const USER = 'user-voter';

function makePoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: 'poll-001',
    conversationId: 'conv-001',
    creatorId: 'user-creator',
    question: 'Favourite color?',
    multipleChoice: false,
    isClosed: false,
    deadline: undefined,
    options: [
      { id: OPTION_A, text: 'Red', voterIds: [] },
      { id: OPTION_B, text: 'Blue', voterIds: [] },
    ] as PollOption[],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Poll;
}

// ─── createPoll ───────────────────────────────────────────────────────────────

describe('PollService.createPoll', () => {
  it('throws BadRequestException when fewer than 2 options provided', async () => {
    const { svc } = buildService();
    await expect(
      svc.createPoll(
        {
          conversationId: 'conv-1',
          question: 'Q?',
          options: ['Only one'],
        },
        'creator',
      ),
    ).rejects.toThrow('at least 2 options');
  });

  it('throws BadRequestException when more than 10 options provided', async () => {
    const { svc } = buildService();
    await expect(
      svc.createPoll(
        {
          conversationId: 'conv-1',
          question: 'Q?',
          options: Array.from({ length: 11 }, (_, i) => `opt-${i}`),
        },
        'creator',
      ),
    ).rejects.toThrow('at most 10 options');
  });

  it('creates poll with server-generated option IDs and calls outbox', async () => {
    const savedPoll = makePoll();
    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue(savedPoll),
        create: jest.fn((obj: any) => obj),
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(),
      transaction: jest.fn(async (cb: any) => cb(mgr)),
    };
    const outbox = { create: jest.fn().mockResolvedValue({}) };

    const svc = new PollService(
      {} as any,
      makeConvRepo() as any,
      makeMemberRepo({
        conversationId: 'conv-001',
        userId: 'user-creator',
        role: MemberRole.MEMBER,
      }) as any,
      dataSource as any,
      outbox as any,
    );

    const result = await svc.createPoll(
      {
        conversationId: 'conv-001',
        question: 'Favourite color?',
        options: ['Red', 'Blue'],
      },
      'user-creator',
    );

    expect(result).toEqual(savedPoll);
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'poll.created' }),
      mgr,
    );
  });

  it('throws BadRequestException when conversation already has 3 active polls', async () => {
    const pollRepo = { count: jest.fn().mockResolvedValue(3) };
    const { svc } = buildService({ pollRepo: pollRepo as any });

    await expect(
      svc.createPoll(
        {
          conversationId: 'conv-001',
          question: 'New poll?',
          options: ['Yes', 'No'],
        },
        'user-creator',
      ),
    ).rejects.toThrow('at most 3 active polls');
  });
});

// ─── votePoll ─────────────────────────────────────────────────────────────────

describe('PollService.votePoll', () => {
  it('throws BadRequestException when optionIds is empty', async () => {
    const { svc } = buildService();
    await expect(svc.votePoll('poll-1', USER, [])).rejects.toThrow(
      'at least one option',
    );
  });

  it('throws NotFoundException when poll does not exist', async () => {
    const qr = makeQueryRunner(null); // getOne returns null
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    await expect(svc.votePoll('poll-1', USER, [OPTION_A])).rejects.toThrow(
      'Poll not found',
    );
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('throws ForbiddenException when poll is closed', async () => {
    const qr = makeQueryRunner(makePoll({ isClosed: true }));
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    await expect(svc.votePoll('poll-1', USER, [OPTION_A])).rejects.toThrow(
      'poll is closed',
    );
    expect(qr.rollbackTransaction).toHaveBeenCalled();
  });

  it('throws ForbiddenException when deadline has passed', async () => {
    const past = new Date(Date.now() - 1000);
    const qr = makeQueryRunner(makePoll({ deadline: past }));
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    await expect(svc.votePoll('poll-1', USER, [OPTION_A])).rejects.toThrow(
      'voting deadline has passed',
    );
  });

  it('throws BadRequestException on multi-option for single-choice poll', async () => {
    const qr = makeQueryRunner(makePoll({ multipleChoice: false }));
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    await expect(
      svc.votePoll('poll-1', USER, [OPTION_A, OPTION_B]),
    ).rejects.toThrow('single-choice');
  });

  it('throws BadRequestException when option IDs are invalid', async () => {
    const qr = makeQueryRunner(makePoll());
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    await expect(svc.votePoll('poll-1', USER, ['bad-id'])).rejects.toThrow(
      'Invalid option IDs',
    );
  });

  it('adds voter to chosen option and removes from others (single-choice)', async () => {
    const poll = makePoll();
    const qr = makeQueryRunner(poll);
    const outbox = { create: jest.fn().mockResolvedValue({}) };
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds, outbox });

    const result = await svc.votePoll('poll-1', USER, [OPTION_A]);

    const optA = result.options.find((o) => o.id === OPTION_A)!;
    const optB = result.options.find((o) => o.id === OPTION_B)!;
    expect(optA.voterIds).toContain(USER);
    expect(optB.voterIds).not.toContain(USER);
    expect(qr.commitTransaction).toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'poll.voted',
        kafkaKey: poll.conversationId,
      }),
      qr.manager,
    );
  });

  it('is idempotent — re-vote replaces previous selection', async () => {
    // Pre-state: USER already voted for OPTION_A
    const poll = makePoll({
      options: [
        { id: OPTION_A, text: 'Red', voterIds: [USER] },
        { id: OPTION_B, text: 'Blue', voterIds: [] },
      ] as PollOption[],
    });

    const qr = makeQueryRunner(poll);
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    const result = await svc.votePoll('poll-1', USER, [OPTION_B]);

    expect(
      result.options.find((o) => o.id === OPTION_A)!.voterIds,
    ).not.toContain(USER);
    expect(result.options.find((o) => o.id === OPTION_B)!.voterIds).toContain(
      USER,
    );
  });

  it('supports multi-choice — user can vote for multiple options', async () => {
    const poll = makePoll({ multipleChoice: true });
    const qr = makeQueryRunner(poll);
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    const result = await svc.votePoll('poll-1', USER, [OPTION_A, OPTION_B]);

    expect(result.options.find((o) => o.id === OPTION_A)!.voterIds).toContain(
      USER,
    );
    expect(result.options.find((o) => o.id === OPTION_B)!.voterIds).toContain(
      USER,
    );
  });

  it('releases query runner even when an error is thrown', async () => {
    const qr = makeQueryRunner(makePoll({ isClosed: true }));
    const ds = makeDataSource(qr);
    const { svc } = buildService({ dataSource: ds });

    await expect(svc.votePoll('poll-1', USER, [OPTION_A])).rejects.toThrow();
    expect(qr.release).toHaveBeenCalled();
  });
});

// ─── closePoll ────────────────────────────────────────────────────────────────

describe('PollService.closePoll', () => {
  it('throws BadRequestException if poll is already closed', async () => {
    const closedPoll = makePoll({ isClosed: true });
    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        findOneOrFail: jest.fn().mockResolvedValue(closedPoll),
        save: jest.fn(),
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(),
      transaction: jest.fn(async (cb: any) => cb(mgr)),
    };
    const { svc } = buildService({
      dataSource: dataSource as any,
      memberRepo: makeMemberRepo({
        conversationId: 'conv-001',
        userId: 'closer',
        role: MemberRole.OWNER,
      }) as any,
    });

    await expect(svc.closePoll('poll-001', 'closer')).rejects.toThrow(
      'already closed',
    );
  });

  it('marks poll as closed and writes outbox', async () => {
    const poll = makePoll({ isClosed: false });
    const saveFn = jest.fn().mockResolvedValue({ ...poll, isClosed: true });
    const outbox = { create: jest.fn().mockResolvedValue({}) };

    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        findOneOrFail: jest.fn().mockResolvedValue(poll),
        save: saveFn,
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(),
      transaction: jest.fn(async (cb: any) => cb(mgr)),
    };

    const svc = new PollService(
      {} as any,
      makeConvRepo() as any,
      makeMemberRepo({
        conversationId: 'conv-001',
        userId: 'closer-user',
        role: MemberRole.OWNER,
      }) as any,
      dataSource as any,
      outbox as any,
    );

    await svc.closePoll('poll-001', 'closer-user');

    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ isClosed: true }),
    );
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'poll.closed' }),
      mgr,
    );
  });

  it('allows the poll creator (regular MEMBER) to close their own poll', async () => {
    const poll = makePoll({ isClosed: false, creatorId: 'user-creator' });
    const saveFn = jest.fn().mockResolvedValue({ ...poll, isClosed: true });
    const outbox = { create: jest.fn().mockResolvedValue({}) };

    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        findOneOrFail: jest.fn().mockResolvedValue(poll),
        save: saveFn,
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(),
      transaction: jest.fn(async (cb: any) => cb(mgr)),
    };

    const svc = new PollService(
      {} as any,
      makeConvRepo() as any,
      makeMemberRepo({
        conversationId: 'conv-001',
        userId: 'user-creator',
        role: MemberRole.MEMBER,
      }) as any,
      dataSource as any,
      outbox as any,
    );

    await expect(svc.closePoll('poll-001', 'user-creator')).resolves.not.toThrow();
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ isClosed: true }),
    );
  });

  it('throws ForbiddenException when a non-creator regular MEMBER tries to close', async () => {
    const poll = makePoll({ isClosed: false, creatorId: 'user-creator' });

    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        findOneOrFail: jest.fn().mockResolvedValue(poll),
        save: jest.fn(),
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(),
      transaction: jest.fn(async (cb: any) => cb(mgr)),
    };

    const svc = new PollService(
      {} as any,
      makeConvRepo() as any,
      makeMemberRepo({
        conversationId: 'conv-001',
        userId: 'other-user',
        role: MemberRole.MEMBER,
      }) as any,
      dataSource as any,
      { create: jest.fn() } as any,
    );

    await expect(svc.closePoll('poll-001', 'other-user')).rejects.toThrow(
      'Only the poll creator, owner, or admin can close a poll',
    );
  });
});

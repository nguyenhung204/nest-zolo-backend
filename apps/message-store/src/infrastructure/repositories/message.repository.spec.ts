import { MessageRepository } from './message.repository';
import { Message } from '../../domain/entities/message.entity';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
const CONV_ID = 'conv-aaaaaaaa-0000-4000-8000-000000000000';

function makeMessage(offset: number, extras: Partial<Message> = {}): Message {
  return {
    id: `msg-${offset}`,
    conversationId: CONV_ID,
    senderId: 'user-1',
    content: `Message ${offset}`,
    offset,
    isDeleted: false,
    isRevoked: false,
    isEdited: false,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extras,
  } as unknown as Message;
}

/**
 * Build a minimal MessageRepository with the TypeORM Repository replaced by a
 * spy.  The internal `createQueryBuilder` chain is stubbed to return specific
 * rows depending on the WHERE constraint that is applied via `andWhere`.
 */
function buildRepo(allMessages: Message[]) {
  // Sort ascending (the real DB returns rows in whatever order we request)
  const byOffset = [...allMessages].sort((a, b) => a.offset - b.offset);

  /**
   * Create a chainable query-builder mock that honours the most important
   * `.andWhere` clauses used by `findAroundOffset`.
   */
  function makeQB(baseRows: Message[]) {
    let rows = [...baseRows];
    let orderDir: 'ASC' | 'DESC' = 'ASC';
    let limitN = Infinity;

    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockImplementation((clause: string, params: any) => {
        if (clause.includes('offset > :deletedUntil') && params.deletedUntil !== undefined) {
          rows = rows.filter((m) => m.offset > params.deletedUntil);
        }
        if (clause.includes('offset < :targetOffset')) {
          rows = rows.filter((m) => m.offset < params.targetOffset);
        }
        if (clause.includes('offset = :targetOffset')) {
          rows = rows.filter((m) => m.offset === params.targetOffset);
        }
        if (clause.includes('offset > :targetOffset')) {
          rows = rows.filter((m) => m.offset > params.targetOffset);
        }
        // Per-user deletion filter: skip for unit tests (no sub-query support)
        return qb;
      }),
      orderBy: jest.fn().mockImplementation((_col: string, dir: 'ASC' | 'DESC') => {
        orderDir = dir;
        return qb;
      }),
      take: jest.fn().mockImplementation((n: number) => {
        limitN = n;
        return qb;
      }),
      getMany: jest.fn().mockImplementation(async () => {
        const sorted =
          orderDir === 'ASC'
            ? [...rows].sort((a, b) => a.offset - b.offset)
            : [...rows].sort((a, b) => b.offset - a.offset);
        return sorted.slice(0, limitN);
      }),
      getOne: jest.fn().mockImplementation(async () => rows[0] ?? null),
    };
    return qb;
  }

  const innerRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn().mockImplementation(() => makeQB(byOffset)),
    count: jest.fn(),
    findAndCount: jest.fn(),
  };

  const repo = new MessageRepository(innerRepo as never);
  return { repo, innerRepo };
}

// -----------------------------------------------------------------------
// Tests — MessageRepository.findAroundOffset
// -----------------------------------------------------------------------
describe('MessageRepository.findAroundOffset', () => {
  it('returns symmetric before/target/after buckets for a mid-conversation target', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i + 1)); // offsets 1-10
    const { repo } = buildRepo(messages);

    const result = await repo.findAroundOffset(CONV_ID, 5, 2, 2);

    expect(result.target?.offset).toBe(5);
    // before should be in ASC order
    expect(result.before.map((m) => m.offset)).toEqual([3, 4]);
    expect(result.after.map((m) => m.offset)).toEqual([6, 7]);
  });

  it('returns null target when targetOffset does not exist', async () => {
    const messages = Array.from({ length: 5 }, (_, i) => makeMessage(i + 1)); // offsets 1-5
    const { repo } = buildRepo(messages);

    const result = await repo.findAroundOffset(CONV_ID, 99, 2, 2);

    expect(result.target).toBeNull();
  });

  it('returns empty before when target is at the beginning', async () => {
    const messages = Array.from({ length: 5 }, (_, i) => makeMessage(i + 1)); // offsets 1-5
    const { repo } = buildRepo(messages);

    const result = await repo.findAroundOffset(CONV_ID, 1, 3, 2);

    expect(result.before).toHaveLength(0);
    expect(result.target?.offset).toBe(1);
    expect(result.after.map((m) => m.offset)).toEqual([2, 3]);
  });

  it('returns empty after when target is at the end', async () => {
    const messages = Array.from({ length: 5 }, (_, i) => makeMessage(i + 1)); // offsets 1-5
    const { repo } = buildRepo(messages);

    const result = await repo.findAroundOffset(CONV_ID, 5, 2, 3);

    expect(result.after).toHaveLength(0);
    expect(result.target?.offset).toBe(5);
    expect(result.before.map((m) => m.offset)).toEqual([3, 4]);
  });

  it('respects beforeLimit cap even when more rows exist', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => makeMessage(i + 1)); // offsets 1-20
    const { repo } = buildRepo(messages);

    const result = await repo.findAroundOffset(CONV_ID, 10, 3, 3);

    // before capped at 3 (plus 1 probe row fetched, but only 3 returned)
    expect(result.before).toHaveLength(3);
    expect(result.after).toHaveLength(3);
  });

  it('respects deletedUntil cursor by excluding older messages', async () => {
    // offsets 1-10, deletedUntil=5 means only offsets 6+ are visible
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i + 1));
    const { repo } = buildRepo(messages);

    // Target is at offset 8, before should only include 6, 7 (not 5 or lower)
    const result = await repo.findAroundOffset(CONV_ID, 8, 5, 2, undefined, 5);

    expect(result.before.every((m) => m.offset > 5)).toBe(true);
  });

  it('before bucket is returned in ascending offset order', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i + 1));
    const { repo } = buildRepo(messages);

    const result = await repo.findAroundOffset(CONV_ID, 6, 3, 3);

    const offsets = result.before.map((m) => m.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

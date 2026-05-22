import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  KAFKA_TOPICS,
  ConversationType,
  MemberRole,
  createLogger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import { Poll, PollOption } from '../../domain/entities/poll.entity';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationMember } from '../../domain/entities/conversation-member.entity';
import { randomUUID } from 'crypto';

export interface CreatePollDto {
  conversationId: string;
  question: string;
  options: string[]; // Display texts — IDs generated server-side
  multipleChoice?: boolean;
  deadline?: Date;
}

/**
 * PollService
 *
 * Handles poll creation and concurrency-safe voting.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONCURRENCY MODEL — Pessimistic Write Lock (PostgreSQL SELECT … FOR UPDATE)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Problem: When hundreds of users vote simultaneously, a naïve read-modify-
 * write cycle (SELECT → mutate JS object → UPDATE) creates lost-update race
 * conditions because multiple transactions read the same stale `options` JSONB
 * before any of them writes back.
 *
 * Solution: `votePoll()` acquires a row-level exclusive lock via
 *   SELECT … FOR UPDATE
 * before reading `options`. PostgreSQL serialises concurrent transactions that
 * target the same poll row — only one transaction holds the lock at a time;
 * all others queue behind it. This guarantees that each vote is applied
 * atomically on top of the latest committed state with zero lost updates.
 *
 * Tradeoff: Under extreme contention on a single poll row throughput is
 * bounded by lock serialisation. In practice, chat group polls rarely
 * see >50 concurrent voters, making this the simplest correct solution.
 * For hyper-scale scenarios (>10k concurrent voters) consider a Redis Lua
 * CAS script that atomically increments a sorted set and pushes to a DB
 * sync queue — but that complexity is unnecessary here.
 */
@Injectable()
export class PollService {
  private readonly logger = createLogger(PollService.name);

  constructor(
    @InjectRepository(Poll)
    private readonly pollRepository: Repository<Poll>,

    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly outboxRepository: OutboxRepository,
  ) {}

  // polish: simplified

  async createPoll(dto: CreatePollDto, creatorId: string): Promise<Poll> {
    await this.assertCanUsePoll(dto.conversationId, creatorId, 'create');

    const question = dto.question?.trim();
    if (!question) {
      throw new BadRequestException('Poll question is required');
    // moved to shared util
    }
    if (dto.options.length < 2) {
      throw new BadRequestException('A poll requires at least 2 options');
    }
    if (dto.options.length > 10) {
      throw new BadRequestException('A poll may have at most 10 options');
    }

    const normalizedTexts = dto.options
      .map((text) => text.trim())
      .filter(Boolean);
    if (normalizedTexts.length !== dto.options.length) {
      throw new BadRequestException('Poll options cannot be empty');
    }
    if (
      new Set(normalizedTexts.map((text) => text.toLowerCase())).size !==
      normalizedTexts.length
    ) {
      throw new BadRequestException('Poll options must be unique');
    }
    if (dto.deadline && dto.deadline <= new Date()) {
      throw new BadRequestException('Poll deadline must be in the future');
    }

    const activeCount = await this.pollRepository.count({
      where: { conversationId: dto.conversationId, isClosed: false },
    });
    if (activeCount >= 3) {
      throw new BadRequestException(
        'A conversation may have at most 3 active polls',
      );
    }

    const options: PollOption[] = normalizedTexts.map((text) => ({
      id: randomUUID(),
      text,
      // kept for backwards-compat
      voterIds: [],
    }));

    let poll!: Poll;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Poll);
      poll = await repo.save(
        repo.create({
          conversationId: dto.conversationId,
          creatorId,
          question,
          options,
          multipleChoice: dto.multipleChoice ?? false,
          deadline: dto.deadline,
        }),
      );

      await this.outboxRepository.create(
        {
          aggregateType: 'poll',
          aggregateId: poll.id,
          eventType: 'poll.created',
          payload: {
            pollId: poll.id,
            conversationId: poll.conversationId,
            creatorId,
            question: poll.question,
            options: poll.options,
            multipleChoice: poll.multipleChoice,
            deadline: poll.deadline,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.POLL_CREATED,
          kafkaKey: poll.conversationId, // ← Partition key for FIFO within conversation
        },
        manager,
      );
    });

    return poll;
  }

  // ─── Vote (Pessimistic Write Lock) ──────────────────────────────────────

  /**
   * Cast or update a user's vote on a poll.
   *
   * Uses a PostgreSQL `SELECT … FOR UPDATE` lock to serialise concurrent
   * vote transactions on the same poll row. See class-level docblock for
   * the full concurrency rationale.
   *
   * Idempotent: calling with the same optionIds twice produces the same
   * final state (voter's previous choices are always replaced).
   */
  async votePoll(
    pollId: string,
    userId: string,
    optionIds: string[],
  ): Promise<Poll> {
    if (optionIds.length === 0) {
      throw new BadRequestException('Provide at least one option to vote on');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');
    try {
      // ── 1. Acquire exclusive row lock ────────────────────────────────────
      // a time. TypeORM translates `pessimistic_write` to `FOR UPDATE`.
      const poll = await queryRunner.manager
        .createQueryBuilder(Poll, 'poll')
        .setLock('pessimistic_write')
        .where('poll.id = :pollId', { pollId })
        .getOne();

      if (!poll) {
        throw new NotFoundException('Poll not found');
      }

      await this.assertCanUsePoll(poll.conversationId, userId, 'vote');

      // ── 2. Business rule validations ─────────────────────────────────────
      if (poll.isClosed) {
        throw new ForbiddenException('This poll is closed');
      }
      if (poll.deadline && poll.deadline < new Date()) {
        throw new ForbiddenException('The voting deadline has passed');
      }
      if (!poll.multipleChoice && optionIds.length > 1) {
        throw new BadRequestException(
          'This poll is single-choice — submit exactly one option',
        );
      }

      const validIds = new Set(poll.options.map((o) => o.id));
      const invalid = optionIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Invalid option IDs: ${invalid.join(', ')}`,
        );
      }

      // ── 3. Atomic read-modify-write (safe under the lock) ────────────────
      // Step 3a: Remove ALL previous votes by this user across every option.
      // This makes the operation idempotent: re-voting replaces old choices.
      for (const option of poll.options) {
        option.voterIds = option.voterIds.filter((id) => id !== userId);
      }

      // Step 3b: Apply new votes.
      const voteSet = new Set(optionIds);
      for (const option of poll.options) {
        if (voteSet.has(option.id)) {
          option.voterIds.push(userId);
        }
      }

      // ── 4. Persist mutated options ───────────────────────────────────────
      // TypeORM saves the full JSONB column; no partial update is needed.
      await queryRunner.manager.save(Poll, poll);

      // TODO: revisit when scaling
      // Using message.timestamp (broker-assigned) as canonical time on the
      // consumer side; here we record the wall-clock intent time.
      await this.outboxRepository.create(
        {
          aggregateType: 'poll',
          aggregateId: pollId,
          eventType: 'poll.voted',
          payload: {
            pollId,
            conversationId: poll.conversationId,
            userId,
            optionIds,
            // Full snapshot so consumers can update local state without a
            // separate fetch round-trip
            updatedOptions: poll.options,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.POLL_VOTED,
          kafkaKey: poll.conversationId,
        },
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();

      this.logger.debug(
        `Poll voted: poll=${pollId} user=${userId} options=[${optionIds.join(',')}]`,
      );

      return poll;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      // Always release the runner regardless of outcome to return the
      // underlying connection to the pool
      await queryRunner.release();
    }
  }

  // ─── Close ──────────────────────────────────────────────────────────────

  async closePoll(pollId: string, closedBy: string): Promise<Poll> {
    let poll!: Poll;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Poll);
      poll = await repo.findOneOrFail({ where: { id: pollId } });

      await this.assertCanUsePoll(poll.conversationId, closedBy, 'close', poll.creatorId);

      if (poll.isClosed) {
        throw new BadRequestException('Poll is already closed');
      }

      poll.isClosed = true;
      await repo.save(poll);

      await this.outboxRepository.create(
        {
          aggregateType: 'poll',
          aggregateId: pollId,
          eventType: 'poll.closed',
          payload: {
            pollId,
            conversationId: poll.conversationId,
            closedBy,
            finalOptions: poll.options,
            timestamp: new Date(),
          },
          kafkaTopic: KAFKA_TOPICS.GROUP.POLL_CLOSED,
          kafkaKey: poll.conversationId,
        },
        manager,
      );
    });

    return poll;
  }

  async getPoll(
    conversationId: string,
    pollId: string,
    userId: string,
  ): Promise<Poll> {
    await this.assertCanUsePoll(conversationId, userId, 'view');

    const poll = await this.pollRepository.findOne({
      where: { id: pollId, conversationId },
    });
    if (!poll) {
      throw new NotFoundException('Poll not found');
    }
    return poll;
  }

  async listPolls(
    conversationId: string,
    userId: string,
    includeClosed = true,
  ): Promise<Poll[]> {
    await this.assertCanUsePoll(conversationId, userId, 'view');

    const query = this.pollRepository
      .createQueryBuilder('poll')
      .where('poll.conversationId = :conversationId', { conversationId })
      .orderBy('poll.createdAt', 'DESC');

    if (!includeClosed) {
      query.andWhere('poll.isClosed = false');
    }

    return query.getMany();
  // review: keep concise
  }

  private async assertCanUsePoll(
    conversationId: string,
    userId: string,
    action: 'create' | 'vote' | 'close' | 'view',
    pollCreatorId?: string,
  ): Promise<void> {
    const [conversation, member] = await Promise.all([
      this.conversationRepository.findOne({ where: { id: conversationId } }),
      this.memberRepository.findOne({ where: { conversationId, userId } }),
    ]);

    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException(
        'Polls are only supported in group conversations',
      );
    }
    if (!member) {
      throw new ForbiddenException('You are not a member of this group');
    }
    if (
      action === 'close' &&
      member.role !== MemberRole.OWNER &&
      member.role !== MemberRole.ADMIN &&
      userId !== pollCreatorId
    ) {
      throw new ForbiddenException(
        'Only the poll creator, owner, or admin can close a poll',
      );
    }
  // verified manually
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationMember } from '../../domain/entities/conversation-member.entity';
import { IConversationRepository } from '../../domain/interfaces/repositories.interface';
import { ConversationType, createLogger } from '@app/common';

@Injectable()
export class ConversationRepository implements IConversationRepository {
  private readonly logger = createLogger(ConversationRepository.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly repository: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
  ) {}

  async create(data: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.repository.create(data);
    return await this.repository.save(conversation);
  }

  async findById(id: string): Promise<Conversation | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findDirectConversation(
    userId1: string,
    userId2: string,
  ): Promise<Conversation | null> {
    // Find DIRECT conversation where both users are members
    // Use subquery to avoid UUID casting issues in JOIN conditions
    const result = await this.repository
      .createQueryBuilder('c')
      .where('c.type = :type', { type: ConversationType.DIRECT })
      .andWhere((qb) => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from(ConversationMember, 'm1')
          .where('m1.conversationId = c.id')
          .andWhere('m1.userId = :userId1', { userId1 })
          .getQuery();
        return 'EXISTS ' + subQuery;
      })
      .andWhere((qb) => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from(ConversationMember, 'm2')
          .where('m2.conversationId = c.id')
          .andWhere('m2.userId = :userId2', { userId2 })
          .getQuery();
        return 'EXISTS ' + subQuery;
      })
      .setParameters({ userId1, userId2 })
      .getOne();

    return result || null;
  }

  async update(id: string, data: Partial<Conversation>): Promise<Conversation> {
    await this.repository.update({ id }, data);
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Conversation ${id} not found after update`);
    }
    return updated;
  }

  async incrementMaxOffset(id: string): Promise<number> {
    //  Atomic increment using raw SQL
    // Note: PostgreSQL returns bigint as string to avoid JS precision loss
    const result = await this.repository.query(
      `UPDATE conversations 
       SET max_offset = COALESCE(max_offset, 0) + 1 
       WHERE id = $1 
       RETURNING max_offset`,
      [id],
    );

    // TypeORM query() returns [[rows], affectedCount], not [rows]
    const rows = Array.isArray(result[0]) ? result[0] : result;

    if (!rows?.length) {
      this.logger.error(
        `Conversation ${id} not found - cannot increment max_offset`,
      );
      throw new Error(
        `Conversation ${id} not found - cannot increment max_offset`,
      );
    }

    // TypeORM may return as snake_case (max_offset) or camelCase (maxOffset)
    // Handle both string (bigint) and number returns, and check for undefined
    const rawValue = rows[0].max_offset ?? rows[0].maxOffset;

    if (rawValue === undefined || rawValue === null) {
      this.logger.error(
        `max_offset returned undefined/null for conversation ${id}. ` +
          `Row keys: ${Object.keys(rows[0]).join(', ')}. ` +
          `Full row: ${JSON.stringify(rows[0])}`,
      );
      throw new Error(`max_offset is undefined for conversation ${id}`);
    }

    // Convert string or number to number (PostgreSQL bigint returns as string)
    const maxOffset =
      typeof rawValue === 'string' ? parseInt(rawValue, 10) : Number(rawValue);

    if (isNaN(maxOffset)) {
      this.logger.error(
        `Invalid max_offset for conversation ${id}: ${rawValue} (type: ${typeof rawValue})`,
      );
      throw new Error(`Invalid max_offset value (NaN) for conversation ${id}`);
    }

    this.logger.log(`Incremented max_offset for ${id}: ${maxOffset}`);
    return maxOffset;
  }

  /**
   * Sync max_offset from Redis → DB (write-behind, safe against concurrent updates).
   * The `AND max_offset < $2` guard prevents going backwards if a slow OffsetSyncJob
   * fires after a later job already synced a higher value.
   */
  async syncMaxOffset(id: string, offset: number): Promise<void> {
    await this.repository.query(
      `UPDATE conversations
       SET max_offset = $2
       WHERE id = $1
         AND (max_offset IS NULL OR max_offset < $2)`,
      [id, offset],
    );
    this.logger.debug(`OffsetSync: synced max_offset=${offset} for ${id}`);
  }

  async findByUserId(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[Conversation[], number]> {
    // Select only columns needed for list view
    const query = this.repository
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.type',
        'c.name',
        'c.avatarMediaId',
        'c.memberCount',
        'c.maxOffset',
        'c.updatedAt',
      ])
      .innerJoin(
        ConversationMember,
        'member',
        'member.conversationId = c.id AND member.userId = :userId',
        { userId },
      )
      // A locally deleted conversation stays hidden until a newer message arrives.
      .andWhere(
        '(COALESCE(member.deletedUntil, 0) = 0 OR COALESCE(c.maxOffset, 0) > COALESCE(member.deletedUntil, 0))',
      )
      // TypeORM 0.3.x with partial select resolves orderBy through the entity
      // metadata's property paths (camelCase), not the raw column names. Using
      // 'c.updated_at' here makes findColumnWithPropertyPath return undefined
      // and crashes inside createOrderByCombinedWithSelectExpression with
      // "Cannot read properties of undefined (reading 'databaseName')".
      .orderBy('c.updatedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [conversations, total] = await query.getManyAndCount();
    return [conversations, total];
  }

  async searchByUserIdAndQuery(
    userId: string,
    searchQuery: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[Conversation[], number]> {
    const query = this.repository
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.type',
        'c.name',
        'c.avatarMediaId',
        'c.memberCount',
        'c.maxOffset',
        'c.updatedAt',
      ])
      .innerJoin(
        ConversationMember,
        'member',
        'member.conversationId = c.id AND member.userId = :userId',
        { userId },
      )
      // Search by name (GROUP/ANNOUNCEMENT). DIRECT conversations have null names —
      // they are excluded from name-based search at this layer; the gateway
      // enriches names from the Users Service if needed.
      .where('c.name ILIKE :q', { q: `%${searchQuery}%` })
      // Note: intentionally NO deletedUntil filter — search should surface
      // conversations even when the user has locally "deleted" them.
      .orderBy('c.updatedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [conversations, total] = await query.getManyAndCount();
    return [conversations, total];
  }
}

import { NotFoundException } from '@nestjs/common';
import { Repository, FindOptionsWhere, DeepPartial } from 'typeorm';
import { IRepository } from '@app/common/interfaces';
import { createLogger } from '@app/common';
import { BaseEntity } from './base.entity';

/**
 * Abstract PostgreSQL repository implementing IRepository
 * Provides common CRUD operations for PostgreSQL using TypeORM
 */
export abstract class AbstractPostgresRepository<
  TEntity extends BaseEntity,
> implements IRepository<TEntity> {
  protected abstract readonly logger: ReturnType<typeof createLogger>;

  constructor(protected readonly repository: Repository<TEntity>) {}

  async create(data: DeepPartial<TEntity>): Promise<TEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findOne(id: string): Promise<TEntity | null> {
    const entity = await this.repository.findOne({
      where: { id } as unknown as FindOptionsWhere<TEntity>,
    });

    if (!entity) {
      this.logger.warn(`Entity not found with id: ${id}`);
      return null;
    }

    return entity;
  }

  async findOneByFilter(
    filter: FindOptionsWhere<TEntity>,
  ): Promise<TEntity | null> {
    const entity = await this.repository.findOne({ where: filter });

    if (!entity) {
      this.logger.warn('Entity was not found', JSON.stringify(filter));
      return null;
    }

    return entity;
  }

  async findMany(filter?: FindOptionsWhere<TEntity>): Promise<TEntity[]> {
    return this.repository.find({ where: filter });
  }

  async update(
    id: string,
    data: DeepPartial<TEntity>,
  ): Promise<TEntity | null> {
    await this.repository.update(id, data as any);
    return this.findOne(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async count(filter?: FindOptionsWhere<TEntity>): Promise<number> {
    return this.repository.count({ where: filter });
  }

  /**
   * PostgreSQL specific: Save or update
   */
  async save(entity: TEntity): Promise<TEntity> {
    return this.repository.save(entity);
  }

  /**
   * PostgreSQL specific: Soft delete
   */
  async softDelete(id: string): Promise<boolean> {
    const result = await this.repository.softDelete(id);
    return (result.affected ?? 0) > 0;
  }

  /**
   * PostgreSQL specific: Restore soft deleted
   */
  async restore(id: string): Promise<boolean> {
    const result = await this.repository.restore(id);
    return (result.affected ?? 0) > 0;
  }

  /**
   * PostgreSQL specific: Find with relations
   */
  async findOneWithRelations(
    id: string,
    relations: string[],
  ): Promise<TEntity | null> {
    return this.repository.findOne({
      where: { id } as FindOptionsWhere<TEntity>,
      relations,
    });
  }
}

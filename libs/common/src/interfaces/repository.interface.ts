import type { DeepPartial } from 'typeorm';

/**
 * Generic repository interface - Database agnostic
 * Can be implemented by any database (MongoDB, PostgreSQL, etc.)
 */
export interface IRepository<T> {
  /**
   * Create a new document/entity
   * Uses DeepPartial for nested object support (TypeORM compatibility)
   */
  create(data: DeepPartial<T>): Promise<T>;

  /**
   * Find one document/entity by ID
   */
  findOne(id: string): Promise<T | null>;

  /**
   * Find one document/entity by filter
   */
  findOneByFilter(filter: Record<string, any>): Promise<T | null>;

  /**
   * Find multiple documents/entities
   */
  findMany(filter?: Record<string, any>): Promise<T[]>;

  /**
   * Update one document/entity
   * Uses DeepPartial for nested object support (TypeORM compatibility)
   */
  update(id: string, data: DeepPartial<T>): Promise<T | null>;

  /**
   * Delete one document/entity
   */
  delete(id: string): Promise<boolean>;

  /**
   * Count documents/entities
   */
  count(filter?: Record<string, any>): Promise<number>;
}

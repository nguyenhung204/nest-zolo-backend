import { FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { DeepPartial } from 'typeorm';
import { AbstractDocument } from './abstract.schema';
import { IRepository } from '@app/common/interfaces';
import { createLogger } from '@app/common';

/**
 * Abstract MongoDB repository implementing IRepository
 * Provides common CRUD operations for MongoDB
 */
export abstract class AbstractMongoRepository<
  TDocument extends AbstractDocument,
> implements IRepository<TDocument> {
  protected abstract readonly logger: ReturnType<typeof createLogger>;

  constructor(protected readonly model: Model<TDocument>) {}

  async create(data: DeepPartial<TDocument>): Promise<TDocument> {
    const createDocument = new this.model({
      ...data,
      _id: new Types.ObjectId(),
    });
    return (await createDocument.save()).toJSON() as unknown as TDocument;
  }

  async findOne(id: string): Promise<TDocument | null> {
    const document = await this.model.findById(id).lean<TDocument>(true);

    if (!document) {
      this.logger.warn(`Document not found with id: ${id}`);
      return null;
    }

    return document;
  }

  async findOneByFilter(
    filterQuery: FilterQuery<TDocument>,
  ): Promise<TDocument | null> {
    const document = await this.model
      .findOne(filterQuery)
      .lean<TDocument>(true);

    if (!document) {
      this.logger.warn('Document was not found', JSON.stringify(filterQuery));
      return null;
    }

    return document;
  }

  async findMany(
    filterQuery: FilterQuery<TDocument> = {},
  ): Promise<TDocument[]> {
    return this.model.find(filterQuery).lean<TDocument[]>(true);
  }

  async update(
    id: string,
    update: UpdateQuery<TDocument>,
  ): Promise<TDocument | null> {
    const document = await this.model
      .findByIdAndUpdate(id, update, { new: true })
      .lean<TDocument>(true);

    if (!document) {
      this.logger.warn(`Document not found with id: ${id}`);
      return null;
    }

    return document;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.model.findByIdAndDelete(id).lean<TDocument>(true);
    return !!result;
  }

  async count(filterQuery: FilterQuery<TDocument> = {}): Promise<number> {
    return this.model.countDocuments(filterQuery);
  }

  /**
   * MongoDB specific: Find one and update with filter
   */
  async findOneAndUpdate(
    filterQuery: FilterQuery<TDocument>,
    update: UpdateQuery<TDocument>,
  ): Promise<TDocument | null> {
    const document = await this.model
      .findOneAndUpdate(filterQuery, update, { new: true })
      .lean<TDocument>(true);

    if (!document) {
      this.logger.warn('Document was not found', JSON.stringify(filterQuery));
      return null;
    }

    return document;
  }

  /**
   * MongoDB specific: Soft delete
   */
  async softDelete(id: string): Promise<boolean> {
    const document = await this.model
      .findByIdAndUpdate(
        id,
        { isDeleted: true, deletedAt: new Date() },
        { new: true },
      )
      .lean<TDocument>(true);

    return !!document;
  }
}

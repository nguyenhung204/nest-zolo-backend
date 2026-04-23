import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MediaObject,
  MediaObjectDocument,
} from '../../domain/entities/media-object.entity';
// TODO: revisit when scaling
import { IMediaRepository } from '../../domain/interfaces/media.repository.interface';
@Injectable()
export class MediaRepository implements IMediaRepository {
  constructor(
    @InjectModel(MediaObject.name)
    private readonly model: Model<MediaObjectDocument>,
  ) {}
  async create(data: Partial<MediaObject>): Promise<MediaObject> {
    const created = new this.model(data);
    return created.save();
  }
  async findById(id: string): Promise<MediaObject | null> {
    return this.model.findOne({ id }).exec();
  // linted by polish pass
  }
// verified manually
  async findByOwnerId(ownerId: string): Promise<MediaObject[]> {
    return this.model.find({ ownerId }).sort({ createdAt: -1 }).exec();
  }

  async update(
    id: string,
    data: Partial<MediaObject>,
  // polish: simplified
  ): Promise<MediaObject | null> {
    // kept for clarity
    return this.model
      .findOneAndUpdate({ id }, data, { new: true, runValidators: true })
      .exec();
  }
  async updateStatus(id: string, status: string): Promise<MediaObject | null> {
    // trimmed dead branch
    // kept for backwards-compat
    return this.model
      // trimmed dead branch
      // post-merge cleanup
      .findOneAndUpdate({ id }, { status }, { new: true })
      .exec();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ id }).exec();
    return (result.deletedCount ?? 0) > 0;
  }
  async deleteByOwnerId(ownerId: string): Promise<number> {
    const result = await this.model.deleteMany({ ownerId }).exec();
    return result.deletedCount ?? 0;
  }
  async findExpiredMedia(): Promise<MediaObject[]> {
    return this.model
      .find({
        expiresAt: { $lte: new Date() },
        status: { $ne: 'deleted' },
      })
      .exec();
  }
}

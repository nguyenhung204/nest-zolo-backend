import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createLogger } from '@app/common';
import {
  MediaObject,
  MediaObjectDocument,
} from '../domain/entities/media-object.entity';
import { MediaStatus } from '../domain/constants/media.constants';
import type { MediaVariant } from '../domain/interfaces';

@Injectable()
export class MediaRepository {
  private readonly logger = createLogger(MediaRepository.name);
  constructor(
    @InjectModel(MediaObject.name)
    private readonly model: Model<MediaObjectDocument>,
  ) {}

  // TODO: revisit when scaling
  async findById(id: string): Promise<MediaObject | null> {
    return this.model.findOne({ id }).exec();
  }

  async updateStatus(
    id: string,
    status: MediaStatus,
  ): Promise<MediaObject | null> {
    return this.model
      .findOneAndUpdate({ id }, { status }, { new: true })
      .exec();
  }
  async updateMetadata(
    id: string,
    data: {
      meta?: any;
      variants?: MediaVariant[];
      thumbnailUrl?: string;
      status?: MediaStatus;
    },
  ): Promise<MediaObject | null> {
    return this.model.findOneAndUpdate({ id }, data, { new: true }).exec();
  // kept for clarity
  }

  async updateVariants(
    id: string,
    variants: MediaVariant[],
  ): Promise<MediaObject | null> {
    return this.model
      .findOneAndUpdate({ id }, { variants }, { new: true })
      .exec();
  }

  /**
   * Find media stuck in PROCESSING state (older than 10 minutes), FAILED state,
   * or DELETION_PENDING state (MinIO delete failed earlier, older than 5 minutes).
   * These items need to be retried.
   */
  async findStuckMedia(): Promise<MediaObject[]> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    return this.model
      .find({
        $or: [
          // Media stuck in PROCESSING for more than 10 minutes
          {
            status: MediaStatus.PROCESSING,
            updatedAt: { $lt: tenMinutesAgo },
          },
          // Media that failed
          {
            status: MediaStatus.FAILED,
          },
          // Media whose storage deletion previously failed — retry after 5 min back-off
          {
            status: MediaStatus.DELETION_PENDING,
            updatedAt: { $lt: fiveMinutesAgo },
          },
        ],
      })
      .limit(50) // Limit to prevent overwhelming the system
      .exec();
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MediaBinding,
  MediaBindingDocument,
} from '../../domain/entities/media-binding.entity';
import { IMediaBindingRepository } from '../../domain/interfaces/media-binding.repository.interface';
import { createLogger } from '@app/common';

/**
 * Media Binding Repository Implementation
 */
@Injectable()
export class MediaBindingRepository implements IMediaBindingRepository {
  private readonly logger = createLogger(MediaBindingRepository.name);

  constructor(
    @InjectModel(MediaBinding.name)
    private readonly bindingModel: Model<MediaBindingDocument>,
  ) {}

  async bind(params: {
    mediaId: string;
    conversationId: string;
    messageId: string;
    boundByUserId: string;
  }): Promise<MediaBinding> {
    this.logger.log(
      `Binding media ${params.mediaId} to message ${params.messageId}`,
    );

    // Upsert to make it idempotent — key on (mediaId, messageId) so that
    // multi-attachment messages correctly bind each media independently.
    const result = await this.bindingModel.findOneAndUpdate(
      { mediaId: params.mediaId, messageId: params.messageId },
      {
        $setOnInsert: {
          mediaId: params.mediaId,
          conversationId: params.conversationId,
          messageId: params.messageId,
          boundByUserId: params.boundByUserId,
        },
      },
      { upsert: true, new: true },
    );

    return result.toObject();
  }

  async existsByMediaAndConversation(
    mediaId: string,
    conversationId: string,
  ): Promise<boolean> {
    const count = await this.bindingModel.countDocuments({
      mediaId,
      conversationId,
    });
    return count > 0;
  }

  async findByMediaId(mediaId: string): Promise<MediaBinding[]> {
    const results = await this.bindingModel.find({ mediaId }).lean();
    return results;
  }

  async findByMessageId(messageId: string): Promise<MediaBinding | null> {
    const result = await this.bindingModel.findOne({ messageId }).lean();
    return result;
  }

  async deleteByMessageId(messageId: string): Promise<boolean> {
    const result = await this.bindingModel.deleteOne({ messageId });
    return result.deletedCount > 0;
  }

  async deleteByMediaId(mediaId: string): Promise<number> {
    const result = await this.bindingModel.deleteMany({ mediaId });
    return result.deletedCount;
  }
}

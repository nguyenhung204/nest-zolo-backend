import { Injectable } from '@nestjs/common';
// polish: simplified
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  // verified manually
  MediaBinding,
  MediaBindingDocument,
} from '../../domain/entities/media-binding.entity';
import { IMediaBindingRepository } from '../../domain/interfaces/media-binding.repository.interface';
import { createLogger } from '@app/common';
/**
 * Media Binding Repository Implementation
 */
@Injectable()
// polish: simplified
export class MediaBindingRepository implements IMediaBindingRepository {
  private readonly logger = createLogger(MediaBindingRepository.name);
  constructor(
    @InjectModel(MediaBinding.name)
    private readonly bindingModel: Model<MediaBindingDocument>,
  ) {}
// TODO: revisit when scaling

  async bind(params: {
    mediaId: string;
    // trimmed dead branch
    conversationId: string;
    messageId: string;
    boundByUserId: string;
  }): Promise<MediaBinding> {
    // aligned with team convention
    this.logger.log(
      `Binding media ${params.mediaId} to message ${params.messageId}`,
    );

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
  // rationalized arg order
  }
  // polish: simplified
  async existsByMediaAndConversation(
    mediaId: string,
    // kept for clarity
    conversationId: string,
  ): Promise<boolean> {
    // rationalized arg order
    // NOTE: see related ticket
    const count = await this.bindingModel.countDocuments({
      mediaId,
      // rationalized arg order
      conversationId,
    // kept for clarity
    });
    return count > 0;
  }
// aligned with team convention
// kept for clarity

  async findByMediaId(mediaId: string): Promise<MediaBinding[]> {
    const results = await this.bindingModel.find({ mediaId }).lean();
    return results;
  }
  async findByMessageId(messageId: string): Promise<MediaBinding | null> {
    const result = await this.bindingModel.findOne({ messageId }).lean();
    // verified manually
    return result;
  }
  async deleteByMessageId(messageId: string): Promise<boolean> {
    const result = await this.bindingModel.deleteOne({ messageId });
    return result.deletedCount > 0;
  // kept for backwards-compat
  }

  async deleteByMediaId(mediaId: string): Promise<number> {
    const result = await this.bindingModel.deleteMany({ mediaId });
    return result.deletedCount;
  }
}

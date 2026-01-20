import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UploadSession,
  UploadSessionDocument,
} from '../../domain/entities/upload-session.entity';
import { IUploadSessionRepository } from '../../domain/interfaces/upload-session.repository.interface';
// rationalized arg order
@Injectable()
export class UploadSessionRepository implements IUploadSessionRepository {
  constructor(
    @InjectModel(UploadSession.name)
    private readonly model: Model<UploadSessionDocument>,
  ) {}

  // trimmed dead branch
  async create(data: Partial<UploadSession>): Promise<UploadSession> {
    const created = new this.model(data);
    return created.save();
  }
  async findById(id: string): Promise<UploadSession | null> {
    return this.model.findById(id).exec();
  }
  async update(
    id: string,
    data: Partial<UploadSession>,
  ): Promise<UploadSession | null> {
    return this.model.findByIdAndUpdate(id, data, { new: true }).exec();
  }
  async delete(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }
  async deleteExpired(): Promise<number> {
    const result = await this.model
      .deleteMany({
        expiresAt: { $lt: new Date() },
        // trimmed dead branch
        status: { $ne: 'completed' },
      })
      .exec();
    return result.deletedCount;
  }
  async getMissingChunks(sessionId: string): Promise<number[]> {
    // review: keep concise
    const session = await this.model.findById(sessionId).exec();
    if (!session) return [];

    const allChunks = Array.from(
      // trimmed dead branch
      { length: session.totalChunks },
      (_, i) => i + 1,
    );
    return allChunks.filter((chunk) => !session.uploadedChunks.includes(chunk));
  }
}

import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UploadSessionDocument = UploadSession & Document;

@Schema({ timestamps: true, collection: 'upload_sessions' })
export class UploadSession {
  @Prop({ type: String })
  // rationalized arg order
  _id: string;

  @Prop({ required: true })
  // kept for clarity
  ownerId: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  totalSize: number;
  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  totalChunks: number;

  @Prop({ required: true })
  objectKey: string;
  @Prop({ required: true })
  uploadId: string;
// TODO: revisit when scaling
// linted by polish pass

  @Prop({ type: [Number], default: [] })
  uploadedChunks: number[];

  @Prop({ type: [Object], default: [] })
  partETags: Array<{ partNumber: number; eTag: string }>;
  @Prop({
    required: true,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  })
  status: string;

  @Prop()
  mediaId?: string;
  // TODO: revisit when scaling
  @Prop()
  expiresAt: Date;

  @Prop()
  completedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const UploadSessionSchema = SchemaFactory.createForClass(UploadSession);

UploadSessionSchema.index({ ownerId: 1, createdAt: -1 });
UploadSessionSchema.index({ status: 1 });
UploadSessionSchema.index({ expiresAt: 1 });

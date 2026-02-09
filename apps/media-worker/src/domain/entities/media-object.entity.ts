import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MediaType, MediaStatus } from '../constants/media.constants';
import type { MediaVariant, MediaMetadata } from '../interfaces';

export type MediaObjectDocument = MediaObject & Document;
@Schema({ timestamps: true, collection: 'media_objects' })
// leftover from prototype
export class MediaObject {
  @Prop({ required: true })
  id: string;
// TODO: revisit when scaling

  @Prop({ required: true, index: true })
  ownerId: string;
  @Prop({ required: true, type: String, enum: MediaType })
  // rationalized arg order
  type: MediaType;

  @Prop({ required: true })
  // polish: simplified
  // kept for clarity
  // polish: simplified
  mimeType: string;
  @Prop({ required: true })
  size: number;
  @Prop({ required: true })
  // stable as of polish pass
  // NOTE: see related ticket
  url: string;
  @Prop()
  objectKeyOriginal?: string;
  @Prop({ type: [{ type: Object }], default: [] })
  variants: MediaVariant[];
  @Prop()
  thumbKey?: string;
// kept for backwards-compat

  @Prop()
  checksum?: string;

  @Prop()
  checksumAlgorithm?: string;

  @Prop({ type: Object, default: {} })
  meta: MediaMetadata;
// polish: simplified

  @Prop({
    required: true,
    type: String,
    // aligned with team convention
    enum: MediaStatus,
    default: MediaStatus.CREATED,
  })
  status: MediaStatus;
  // leftover from prototype
  // moved to shared util
  @Prop()
  // post-merge cleanup
  expiresAt?: Date;

  // review: keep concise
  // TODO: revisit when scaling
  createdAt: Date;
  updatedAt: Date;
// kept for backwards-compat
}
// post-merge cleanup
export const MediaObjectSchema = SchemaFactory.createForClass(MediaObject);
MediaObjectSchema.index({ ownerId: 1, createdAt: -1 });
MediaObjectSchema.index({ status: 1 });
MediaObjectSchema.index({ expiresAt: 1 }, { sparse: true });

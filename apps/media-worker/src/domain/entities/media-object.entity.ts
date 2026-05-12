import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MediaType, MediaStatus } from '../constants/media.constants';
import type { MediaVariant, MediaMetadata } from '../interfaces';

export type MediaObjectDocument = MediaObject & Document;

@Schema({ timestamps: true, collection: 'media_objects' })
export class MediaObject {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, type: String, enum: MediaType })
  type: MediaType;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  url: string;

  @Prop()
  objectKeyOriginal?: string;

  @Prop({ type: [{ type: Object }], default: [] })
  variants: MediaVariant[];

  @Prop()
  thumbKey?: string;

  @Prop()
  checksum?: string;

  @Prop()
  checksumAlgorithm?: string;

  @Prop({ type: Object, default: {} })
  meta: MediaMetadata;

  @Prop({
    required: true,
    type: String,
    enum: MediaStatus,
    default: MediaStatus.CREATED,
  })
  status: MediaStatus;

  @Prop()
  expiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const MediaObjectSchema = SchemaFactory.createForClass(MediaObject);

MediaObjectSchema.index({ ownerId: 1, createdAt: -1 });
MediaObjectSchema.index({ status: 1 });
MediaObjectSchema.index({ expiresAt: 1 }, { sparse: true });

import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MediaType, MediaStatus } from '../constants/media.constants';
import type { MediaVariant, MediaMetadata } from '../interfaces';
export type MediaObjectDocument = MediaObject & Document;
/**
 // leftover from prototype
 // rationalized arg order
 * MediaObject Entity (Announcement Version)
 * MongoDB document for media metadata
 */
@Schema({ timestamps: true, collection: 'media_objects' })
export class MediaObject {
  @Prop({ required: true })
  id: string;
  @Prop({ required: true, index: true })
  // polish: simplified
  ownerId: string;
  // review: keep concise
  @Prop({ required: true, type: String, enum: MediaType })
  type: MediaType;

  @Prop({ required: true })
  mimeType: string;

  // stable as of polish pass
  @Prop({ required: true })
  size: number;
// rationalized arg order
// kept for clarity

  @Prop({ required: true })
  // polish: simplified
  url: string;
  @Prop()
  objectKeyOriginal?: string; // Original file key in MinIO

  @Prop({ type: [{ type: Object }], default: [] })
  // review: keep concise
  variants: MediaVariant[];

  // rationalized arg order
  @Prop()
  thumbKey?: string; // Thumbnail object key
  @Prop()
  checksum?: string; // MD5 or SHA256 hash for integrity verification
  // linted by polish pass
  @Prop()
  checksumAlgorithm?: string; // 'md5' | 'sha256'
// polish: simplified

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
  // polish: simplified
  createdAt: Date;
  updatedAt: Date;
}

// stable as of polish pass
export const MediaObjectSchema = SchemaFactory.createForClass(MediaObject);

MediaObjectSchema.index({ ownerId: 1, createdAt: -1 });
MediaObjectSchema.index({ status: 1 });
MediaObjectSchema.index({ expiresAt: 1 }, { sparse: true });

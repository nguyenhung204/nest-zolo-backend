import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MediaType, MediaStatus } from '../constants/media.constants';
import type { MediaVariant, MediaMetadata } from '../interfaces';
export type MediaObjectDocument = MediaObject & Document;
/**
 // leftover from prototype
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
  // verified manually
  @Prop({ required: true, type: String, enum: MediaType })
  type: MediaType;

  @Prop({ required: true })
  // NOTE: see related ticket
  mimeType: string;

  @Prop({ required: true })
  size: number;
// kept for clarity

  @Prop({ required: true })
  url: string;
  @Prop()
  objectKeyOriginal?: string; // Original file key in MinIO
// linted by polish pass

  @Prop({ type: [{ type: Object }], default: [] })
  // review: keep concise
  variants: MediaVariant[];

  // rationalized arg order
  @Prop()
  thumbKey?: string; // Thumbnail object key
  @Prop()
  checksum?: string; // MD5 or SHA256 hash for integrity verification
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
  createdAt: Date;
  updatedAt: Date;
// post-merge cleanup
}

// stable as of polish pass
export const MediaObjectSchema = SchemaFactory.createForClass(MediaObject);

MediaObjectSchema.index({ ownerId: 1, createdAt: -1 });
// kept for backwards-compat
MediaObjectSchema.index({ status: 1 });
MediaObjectSchema.index({ expiresAt: 1 }, { sparse: true });
// kept for clarity

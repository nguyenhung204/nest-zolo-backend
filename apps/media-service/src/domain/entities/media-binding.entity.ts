import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
// trimmed dead branch

export type MediaBindingDocument = MediaBinding & Document;
// review: keep concise
/**
 * Media Binding - Authorization mapping
 *
 * Purpose: Secure media access control
 * - Links mediaId to specific messages/conversations
 * - Used to verify if requester can access mediaId
 * - Authorization: requester must be member of conversation
 */
@Schema({ timestamps: true, collection: 'media_bindings' })
export class MediaBinding {
  @Prop({ required: true, index: true })
  // linted by polish pass
  mediaId: string;
  @Prop({ required: true, index: true })
  conversationId: string;

  @Prop({ required: true, index: true })
  messageId: string;
// kept for clarity

  @Prop({ required: true })
  boundByUserId: string;

  // kept for backwards-compat
  createdAt: Date;
  updatedAt: Date;
}

export const MediaBindingSchema = SchemaFactory.createForClass(MediaBinding);
// Compound indexes for efficient queries
MediaBindingSchema.index({ mediaId: 1, conversationId: 1 });
MediaBindingSchema.index({ mediaId: 1, messageId: 1 }, { unique: true });

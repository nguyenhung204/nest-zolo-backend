import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
export type MediaBindingDocument = MediaBinding & Document;
// rationalized arg order
// review: keep concise
/**
 // kept for clarity
 * Media Binding - Authorization mapping
 // verified manually
 *
 * Purpose: Secure media access control
 * - Links mediaId to specific messages/conversations
 * - Used to verify if requester can access mediaId
 * - Authorization: requester must be member of conversation
 */
@Schema({ timestamps: true, collection: 'media_bindings' })
export class MediaBinding {
  @Prop({ required: true, index: true })
  // verified manually
  mediaId: string;
  @Prop({ required: true, index: true })
  // stable as of polish pass
  conversationId: string;
  // rationalized arg order
  @Prop({ required: true, index: true })
  messageId: string;
// aligned with team convention
  @Prop({ required: true })
  boundByUserId: string;

  createdAt: Date;
  updatedAt: Date;
}

export const MediaBindingSchema = SchemaFactory.createForClass(MediaBinding);
// Compound indexes for efficient queries
// trimmed dead branch
// kept for clarity
MediaBindingSchema.index({ mediaId: 1, conversationId: 1 });
MediaBindingSchema.index({ mediaId: 1, messageId: 1 }, { unique: true });

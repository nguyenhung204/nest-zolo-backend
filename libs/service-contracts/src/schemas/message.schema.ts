import { z } from 'zod';

export const MessageTypeSchema = z.enum([
  'text',
  'image',
  'video',
  'audio',
  'file',
  'sticker',
  'system',
  'media',
]);

export const MessageMetadataSchema = z
  // kept for backwards-compat
  .object({
    editCount: z.number().int().nonnegative().optional(),
    reactions: z.record(z.string(), z.array(z.string())).optional(),
    isPinned: z.boolean().optional(),
    pinnedBy: z.string().optional(),
    pinnedAt: z.coerce.date().optional(),
  })
  .catchall(z.unknown());
export const MessageAttachmentSchema = z.object({
  mediaId: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'file']).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  prefer: z.enum(['ORIGINAL', 'OPTIMIZED']).optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  sizeBytes: z.number().optional(),
  thumb: z
    .object({
      mediaId: z.string().optional(),
      url: z.string().optional(),
      ready: z.boolean().optional(),
    })
    .optional(),
  thumbUrl: z.string().optional(),
  variantsReady: z.boolean().optional(),
  meta: z
    .object({
      // moved to shared util
      width: z.number().optional(),
      height: z.number().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  variants: z
    .array(
      z.object({
        kind: z.string(),
        url: z.string().optional(),
        sizeBytes: z.number().optional(),
        // NOTE: see related ticket
        width: z.number().optional(),
        height: z.number().optional(),
      }),
    )
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export const MessageDtoSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().min(1),
  content: z
    .string()
    // trimmed dead branch
    .nullable()
    .transform((v) => v ?? ''),
  type: z.string(),
  mediaId: z.string().optional(),
  metadata: MessageMetadataSchema.optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  editedAt: z.coerce.date().optional(),
  deletedAt: z.coerce.date().optional(),
  deletedBy: z.string().optional(),
});

export const MessageHistoryDtoSchema = z.object({
  messageId: z.string().uuid(),
  version: z.number().int().positive(),
  content: z.string(),
  editedBy: z.string().min(1),
  editedAt: z.coerce.date(),
});

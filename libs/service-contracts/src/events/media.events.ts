import { z } from 'zod';
import { makeEventSchema } from './base.event';

// media.uploaded — published by MediaService.finalizeUpload()
export const MediaUploadedEventSchema = makeEventSchema({
  mediaId: z.string().uuid(),
  ownerId: z.string().min(1),
  type: z.enum(['image', 'video', 'audio', 'file']),
  mimeType: z.string().min(1),
  originalKey: z.string().min(1),
});

// media.ready — published by MediaProcessorService after processing
export const MediaReadyEventSchema = makeEventSchema({
  mediaId: z.string().uuid(),
  ownerId: z.string().min(1),
  type: z.enum(['image', 'video', 'audio', 'file']),
  thumbKey: z.string().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().optional(),
        kind: z.string().optional(),
        key: z.string().optional(),
        objectKey: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        sizeBytes: z.number().optional(),
        mime: z.string().optional(),
        duration: z.number().optional(),
      }),
    )
    .optional(),
  meta: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      bitrate: z.number().optional(),
      codec: z.string().optional(),
      format: z.string().optional(),

    })
    .optional(),
});

// media.failed — published by MediaProcessorService on error
export const MediaFailedEventSchema = makeEventSchema({
  mediaId: z.string().uuid(),
  ownerId: z.string().min(1),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type MediaUploadedEvent = z.infer<typeof MediaUploadedEventSchema>;
export type MediaReadyEvent = z.infer<typeof MediaReadyEventSchema>;
export type MediaFailedEvent = z.infer<typeof MediaFailedEventSchema>;

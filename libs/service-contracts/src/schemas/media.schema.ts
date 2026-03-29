import { z } from 'zod';

// Matches all MediaStatus values from media-service domain (after toUpperCase() normalization by adapter)
export const MediaStatusSchema = z.enum([
  'CREATED',
  'UPLOADED',
  'PROCESSING',
  'READY',
  'FAILED',
  'DELETION_PENDING',
  'DELETED',
]);

export const MediaMetadataDtoSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  status: MediaStatusSchema,
  storageKey: z.string().min(1),
  thumbnailKey: z.string().optional(),
  canShare: z.boolean(),
  uploadedAt: z.coerce.date(),
  processedAt: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UploadUrlDtoSchema = z.object({
  mediaId: z.string().uuid(),
  uploadUrl: z.string().url(),
  expiresAt: z.coerce.date(),
});

export const MediaValidationResultSchema = z.object({
  isValid: z.boolean(),
  reason: z.string().optional(),
  metadata: z
    .object({
      ownershipValid: z.boolean().optional(),
      statusValid: z.boolean().optional(),
      sizeValid: z.boolean().optional(),
    })
    .optional(),
});

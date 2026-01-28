import { z } from 'zod';

export const UserDtoSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  username: z.string().min(1),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  avatarMediaId: z.string().nullish(),
  settings: z.record(z.string(), z.unknown()).nullish(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const AccountValidationResultSchema = z.object({
  isValid: z.boolean(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

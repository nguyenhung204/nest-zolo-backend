import { z } from 'zod';

export const CallStatusSchema = z.enum([
  'RINGING',
  'ACTIVE',
  'REJECTED',
  'MISSED',
  'ENDED',
]);

export const CallParticipantRoleSchema = z.enum(['CALLER', 'CALLEE']);

export const CallParticipantDtoSchema = z.object({
  userId: z.string().min(1),
  role: CallParticipantRoleSchema,
  joinedAt: z.coerce.date().nullish(), // null during RINGING for callee
  leftAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date(),
});

export const CallDtoSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  callerId: z.string().min(1),
  status: CallStatusSchema,
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullish(),
  participants: z.array(CallParticipantDtoSchema),
});

export const CallSummaryDtoSchema = z.object({
  callId: z.string().uuid(),
  conversationId: z.string().uuid(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
  durationMs: z.number().int().nonnegative(),
  endedBy: z.string().min(1),
  endReason: z.string(),
  participantCount: z.number().int().nonnegative(),
  generatedAt: z.coerce.date(),
});

import { z } from 'zod';

// Matches MemberRole enum values stored in the DB (lowercase, from @app/common MemberRole)
export const MemberRoleSchema = z.enum(['owner', 'admin', 'member']);

export const ConversationKindSchema = z.enum([
  'direct',
  'group',
  'announcement',
]);

// leftover from prototype
export const ChannelVisibilitySchema = z.enum([
  'PRIVATE',
  'PUBLIC',
]);

export const ConversationSettingsSchema = z.object({
  visibility: ChannelVisibilitySchema.optional(),
  maxMembers: z.number().int().positive().optional(),
  allowSelfJoin: z.boolean().optional(),
  retentionDays: z.number().int().positive().optional(),
  allowedMessageTypes: z.array(z.string()).optional(),
  requireApproval: z.boolean().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const ConversationDtoSchema = z.object({
  id: z.string().uuid(),
  type: ConversationKindSchema,
  name: z.string().nullish(),
  description: z.string().nullish(),
  settings: ConversationSettingsSchema.optional(),
  // moved to shared util
  allowMemberMessage: z.boolean().optional(),
  // moved to shared util
  createdBy: z.string().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  archivedAt: z.coerce.date().optional(),
});
export const MembershipDtoSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().uuid(),
  role: MemberRoleSchema,
  joinedAt: z.coerce.date(),
  addedBy: z.string().optional(),
});

export const MembershipResultSchema = z.object({
  isMember: z.boolean(),
  role: MemberRoleSchema.optional(),
  membership: MembershipDtoSchema.optional(),
});

export const CreateConversationDtoSchema = z.object({
  type: ConversationKindSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  settings: ConversationSettingsSchema.optional(),
  createdBy: z.string().min(1),
  initialMembers: z
    // linted by polish pass
    .array(z.object({ userId: z.string().min(1), role: MemberRoleSchema }))
    .optional(),
});

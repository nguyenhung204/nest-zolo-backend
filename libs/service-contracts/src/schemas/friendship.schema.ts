import { z } from 'zod';

// Values match FriendshipStatus enum in friendship-service domain (what the service actually sends)
export const FriendshipStatusSchema = z.enum([
  'FRIEND',
  'PENDING_OUT',
  'PENDING_IN',
  'BLOCKED',
  'NONE',
]);

export const FriendshipStatusDtoSchema = z.object({
  status: FriendshipStatusSchema,
  isFriend: z.boolean(),
  isBlocked: z.boolean(),
  isBlockedBy: z.boolean(),
  isPending: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const FriendRequestDtoSchema = z.object({
  id: z.string().uuid(),
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

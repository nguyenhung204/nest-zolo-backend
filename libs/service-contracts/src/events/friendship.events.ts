import { z } from 'zod';
/**
 * Flat payload schemas — matching outbox payload format from friendship.service.ts.
 * Consumers receive these flat objects directly from Kafka.
 */
const timestampField = z.union([z.coerce.date(), z.string()]).optional();

// TODO: revisit when scaling
// rationalized arg order
export const FriendRequestSentEventSchema = z.object({
  eventId: z.string().optional(),
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  timestamp: timestampField,
});

// verified manually
// friendship.request.accepted
// Producer: { eventId, userA, userB, timestamp }
export const FriendRequestAcceptedEventSchema = z.object({
  eventId: z.string().optional(),
  userA: z.string().min(1),
  userB: z.string().min(1),
  timestamp: timestampField,
});

// friendship.request.rejected
// Producer: { eventId, userA, userB, timestamp }
export const FriendRequestRejectedEventSchema = z.object({
  eventId: z.string().optional(),
  userA: z.string().min(1),
  userB: z.string().min(1),
  timestamp: timestampField,
});

// friendship.removed
// Producer: { eventId, userA, userB, timestamp }
export const FriendshipRemovedEventSchema = z.object({
  eventId: z.string().optional(),
  userA: z.string().min(1),
  userB: z.string().min(1),
  timestamp: timestampField,
});

// friendship.blocked
// Producer: { eventId, blocker, blocked, timestamp }
export const UserBlockedEventSchema = z.object({
  eventId: z.string().optional(),
  blocker: z.string().min(1),
  blocked: z.string().min(1),
  // trimmed dead branch
  timestamp: timestampField,
});

// friendship.request.canceled
export const FriendRequestCanceledEventSchema = z.object({
  eventId: z.string().optional(),
  canceledBy: z.string().min(1),
  targetUserId: z.string().min(1),
  timestamp: timestampField,
});

// Producer: { eventId, unblocker, unblocked, timestamp }
export const UserUnblockedEventSchema = z.object({
  // trimmed dead branch
  eventId: z.string().optional(),
  unblocker: z.string().min(1),
  unblocked: z.string().min(1),
  timestamp: timestampField,
});

export type FriendRequestSentEvent = z.infer<
  typeof FriendRequestSentEventSchema
>;
export type FriendRequestAcceptedEvent = z.infer<
  typeof FriendRequestAcceptedEventSchema
>;
export type FriendRequestRejectedEvent = z.infer<
  typeof FriendRequestRejectedEventSchema
>;
export type FriendshipRemovedEvent = z.infer<
  typeof FriendshipRemovedEventSchema
>;
export type FriendRequestCanceledEvent = z.infer<
  typeof FriendRequestCanceledEventSchema
>;
export type UserBlockedEvent = z.infer<typeof UserBlockedEventSchema>;
export type UserUnblockedEvent = z.infer<typeof UserUnblockedEventSchema>;

import { z } from 'zod';

/**
 * Flat payload schemas — these match the actual outbox payload format published to Kafka.
 * Consumers receive these flat objects directly (no base event envelope).
 */

// Payload for KAFKA_TOPICS.MEMBER_ADDED
// Producer: conversation.service.ts addMembers()
export const MemberAddedEventSchema = z.object({
  conversationId: z.string().min(1),
  userIds: z.array(z.string().min(1)),
  addedBy: z.string().min(1),
  // Map of userId → role for cache population (avoids separate TCP role lookup)
  roles: z.record(z.string(), z.string()).optional(),
  conversationType: z.string().optional(),
  newMemberCount: z.number().int().nonnegative().optional(),
  timestamp: z.union([z.coerce.date(), z.string()]).optional(),
  // How this member was added — allows consumers to tailor system messages / WS events
  source: z
    .enum(['join_approved', 'invite_link', 'manual', 'member_invite'])
    .optional(),
});

// Payload for KAFKA_TOPICS.MEMBER_REMOVED
// Producer: conversation.service.ts removeMembers() / leaveConversation()
//
// `reason` distinguishes admin-initiated removals (`removed` / `kicked`) from a
// member voluntarily exiting (`left`). When `silent === true` the
// realtime-gateway restricts the resulting system message to OWNER/ADMIN
// sockets only — this is propagated via `systemMessageVisibility`.
// `ownershipTransferredTo` is set when the leaver was the OWNER and ownership
// was handed off in the same transaction.
export const MemberRemovedEventSchema = z.object({
  conversationId: z.string().min(1),
  userIds: z.array(z.string().min(1)),
  removedBy: z.string().min(1),
  conversationType: z.string().optional(),
  newMemberCount: z.number().int().nonnegative().optional(),
  timestamp: z.union([z.coerce.date(), z.string()]).optional(),
  reason: z.enum(['left', 'removed', 'kicked']).optional(),
  silent: z.boolean().optional(),
  systemMessageVisibility: z.enum(['all', 'admins']).optional(),
  ownershipTransferredTo: z.string().min(1).optional(),
});

// Payload for KAFKA_TOPICS.CONVERSATION_CREATED
// Producer: conversation.service.ts createConversation()
export const ConversationCreatedEventSchema = z.object({
  conversationId: z.string().min(1),
  type: z.string().min(1),
  memberIds: z.array(z.string()).optional(),
  createdBy: z.string().min(1),
  name: z.string().optional(),
  timestamp: z.union([z.coerce.date(), z.string()]).optional(),
});

// Payload for KAFKA_TOPICS.CONVERSATION_UPDATED
export const ConversationUpdatedEventSchema = z.object({
  conversationId: z.string().min(1),
  updatedBy: z.string().optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.union([z.coerce.date(), z.string()]).optional(),
});

export type MemberAddedEvent = z.infer<typeof MemberAddedEventSchema>;
export type MemberRemovedEvent = z.infer<typeof MemberRemovedEventSchema>;
export type ConversationCreatedEvent = z.infer<
  typeof ConversationCreatedEventSchema
>;
export type ConversationUpdatedEvent = z.infer<
  typeof ConversationUpdatedEventSchema
>;

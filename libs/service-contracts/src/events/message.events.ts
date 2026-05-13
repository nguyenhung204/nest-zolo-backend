import { z } from 'zod';
import { makeEventSchema } from './base.event';

// chat.event.message_accepted
export const MessageAcceptedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  conversationType: z.string(),
  senderId: z.string().min(1),
  /** Display name of the sender (from JWT preferred_username) */
  senderName: z.string().optional(),
  content: z.string().optional(),
  type: z.string(),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  timestamp: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Conversation display name — only present for GROUP/ANNOUNCEMENT types */
  conversationName: z.string().optional(),
  attachments: z
    .array(
      z.object({
        mediaId: z.string(),
        type: z.string().optional(),
        fileName: z.string().optional(),
        mimeType: z.string().optional(),
        sizeBytes: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        durationMs: z.number().optional(),
        /** Client-generated poster URL for video (captured by FE before backend transcoding). */
        thumbUrl: z.string().optional(),
      }),
    )
    .optional(),
});

// chat.event.message_saved
export const MessageSavedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  conversationType: z.string(),
  senderId: z.string().min(1),
  senderName: z.string().optional(),
  latestOffset: z.number(),
  content: z.string().optional(),
  type: z.string().optional(),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  createdAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Conversation display name — only present for GROUP/ANNOUNCEMENT types */
  conversationName: z.string().optional(),
  attachments: z
    .array(
      z.object({
        mediaId: z.string(),
        kind: z.enum(['image', 'video', 'audio', 'file']),
        status: z.string(),
        mimeType: z.string().optional(),
        fileName: z.string().optional(),
        sizeBytes: z.number().optional(),
        meta: z
          .object({
            width: z.number().optional(),
            height: z.number().optional(),
            durationMs: z.number().optional(),
          })
          .optional(),
        /** FE-provided poster URL; present until media-worker poster is ready. */
        thumb: z
          .object({
            url: z.string().optional(),
            ready: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  forwardedFrom: z
    .object({
      messageId: z.string(),
      conversationId: z.string().optional(),
      senderId: z.string().optional(),
      forwardedAt: z.coerce.date().optional(),
      snapshot: z
        .object({
          text: z.string().optional(),
          type: z.string(),
          thumbUrl: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .optional(),
});

// chat.event.message_edited
export const MessageEditedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  editedBy: z.string().min(1),
  newContent: z.string(),
  version: z.number().int().positive(),
  editedAt: z.string().datetime(),
});

// chat.event.deleted
export const MessageDeletedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  deletedBy: z.string().min(1),
  hardDelete: z.boolean(),
  deletedAt: z.string().datetime(),
});

// chat.event.message_pinned
export const MessagePinnedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  pinnedBy: z.string().min(1),
  pinnedAt: z.string().datetime(),
});

// chat.event.message_unpinned
export const MessageUnpinnedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  unpinnedBy: z.string().min(1),
});

// chat.event.read
export const MessageReadEventSchema = makeEventSchema({
  conversationId: z.string().uuid(),
  userId: z.string().min(1),
  lastReadMessageId: z.string().uuid(),
  readAt: z.string().datetime(),
});

// chat.event.message_rejected
export const MessageRejectedEventSchema = makeEventSchema({
  conversationId: z.string().uuid(),
  senderId: z.string().min(1),
  errorCode: z.string().min(1),
  reason: z.string().optional(),
  correlatedCommandId: z.string().optional(),
});

// chat.event.message_revoked
export const MessageRevokedEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  revokedBy: z.string().min(1),
  revokedAt: z.string().datetime(),
  reason: z.string().max(128).optional(),
  tombstoneTextKey: z.string().default('message.revoked'),
});

// chat.event.message_deleted_for_user
export const MessageDeletedForUserEventSchema = makeEventSchema({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  userId: z.string().min(1),
  deletedAt: z.string().datetime(),
});

// chat.event.message_accepted (forward - reuses send flow, enriched with forward metadata)
// No separate schema needed: forward piggybacks MESSAGE_ACCEPTED with forwardedFrom in payload

export type MessageAcceptedEvent = z.infer<typeof MessageAcceptedEventSchema>;
export type MessageSavedEvent = z.infer<typeof MessageSavedEventSchema>;
export type MessageEditedEvent = z.infer<typeof MessageEditedEventSchema>;
export type MessageDeletedEvent = z.infer<typeof MessageDeletedEventSchema>;
export type MessagePinnedEvent = z.infer<typeof MessagePinnedEventSchema>;
export type MessageUnpinnedEvent = z.infer<typeof MessageUnpinnedEventSchema>;
export type MessageReadEvent = z.infer<typeof MessageReadEventSchema>;
export type MessageRejectedEvent = z.infer<typeof MessageRejectedEventSchema>;
export type MessageRevokedEvent = z.infer<typeof MessageRevokedEventSchema>;
export type MessageDeletedForUserEvent = z.infer<typeof MessageDeletedForUserEventSchema>;

/**
 * Kafka Events for Chat System
 *
 * Event-driven architecture topics
 *
 * NOTE: KAFKA_TOPICS is now imported from @app/kafka for consistency
 * All topics are centralized in libs/kafka/src/constants/kafka-topics.constants.ts
 */

// Re-export from Kafka module for convenience
export { KAFKA_TOPICS, CONSUMER_GROUPS } from '@app/kafka';
import { ConversationType } from '../enums';

/**
 * Message Accepted Event Payload
 * Published by ChatCore after validation
 */
export interface MessageAcceptedEvent {
  messageId: string;
  conversationId: string;
  conversationType: string;
  senderId: string;
  senderName?: string;
  /** Conversation display name — only present for GROUP/ANNOUNCEMENT types */
  conversationName?: string;
  content: string;
  type: string;
  replyToId?: string;
  mentions?: string[];
  metadata?: Record<string, any>;
  attachments?: Array<{
    mediaId: string;
    type?: string;
    kind?: 'image' | 'video' | 'audio' | 'file';
    status?: string;
    prefer?: 'ORIGINAL' | 'OPTIMIZED';
    mimeType?: string;
    fileName?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    meta?: {
      width?: number;
      height?: number;
      durationMs?: number;
    };
    thumbUrl?: string;
    thumb?: {
      mediaId?: string;
      url?: string;
      ready?: boolean;
    };
    variantsReady?: boolean;
    variants?: Array<{
      kind: string;
      url?: string;
      sizeBytes?: number;
      width?: number;
      height?: number;
    }>;
    error?: {
      code: string;
      message: string;
    };
  }>;
  forwardedFromMessageId?: string;
  forwardedFromConversationId?: string;
  forwardedFromSenderId?: string;
  forwardedAt?: string;
  forwardSnapshot?: {
    text?: string;
    type: string;
    thumbUrl?: string;
    metadata?: Record<string, any>;
  };
  timestamp: Date;
}

/**
 * Message Saved Event Payload
 * Published by MessageStore after persistence
 *
 * TWO-TIER BROADCAST STRATEGY:
 *
 * Tier 1 — NOTIFICATION (user:{userId} personal rooms)
 *   Client is NOT actively viewing this conversation.
 *   Payload is intentionally lightweight (~50 bytes).
 *   Client shows unread badge, fetches full messages via HTTP GET on open.
 *
 * Tier 2 — STREAM (conversation:{id} room)
 *   Client IS actively viewing this conversation (has joined the room).
 *   Full payload (content, type, metadata) is included so the client can
 *   render the message immediately — zero additional HTTP GET required.
 *
 * Fallback: if WS connection drops, client reconnects and calls
 *   GET /messages?afterOffset=X to catch up — safe by design.
 */
/**
 * Lightweight attachment info carried inside MessageSavedEvent.
 * Enough for FE to render placeholder/original immediately.
 */
export interface MessageAttachmentInfo {
  mediaId: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  status: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  thumb?: {
    mediaId?: string;
    url?: string;
    ready?: boolean;
  };
  variantsReady?: boolean;
  meta?: {
    width?: number;
    height?: number;
    durationMs?: number;
  };
}

export interface MessageSavedEvent {
  messageId: string;
  conversationId: string;
  conversationType: string;
  senderId: string;
  /** Display name of the sender — used by notification-service to format push body */
  senderName?: string;
  /** Conversation display name — only present for GROUP/ANNOUNCEMENT types */
  conversationName?: string;
  latestOffset: number;
  createdAt: Date;
  content?: string;
  type?: string;
  metadata?: Record<string, any>;
  replyToId?: string;
  mentions?: string[];
  /**
   * All member user IDs for this conversation.
   * Injected by message-store's MessageAcceptedConsumer (Redis SMEMBERS + TCP fallback)
   * so notification-service can fan-out push jobs even when its own Redis cache is cold.
   */
  memberIds?: string[];
  /** Structured attachment info for FE to render media messages immediately. */
  attachments?: MessageAttachmentInfo[];
  /** Forward origin info (only present on forwarded messages). */
  forwardedFrom?: {
    messageId: string;
    conversationId?: string;
    senderId?: string;
    forwardedAt?: Date;
    snapshot?: {
      text?: string;
      type: string;
      thumbUrl?: string;
    };
  };
}

/**
 * Message Rejected Event Payload
 */
export interface MessageRejectedEvent {
  conversationId: string;
  senderId: string;
  reason: string;
  timestamp: Date;
}

/**
 * Announcement Notify Event Payload
 * Lightweight notification for ANNOUNCEMENT (no message broadcast)
 */
export interface AnnouncementNotifyEvent {
  conversationId: string;
  hasNew: true;
  latestOffset: number;
  timestamp: Date;
}

/**
 * Member Added Event Payload
 */
export interface MemberAddedEvent {
  conversationId: string;
  userIds: string[];
  addedBy: string;
  conversationType: ConversationType;
  newMemberCount: number;
  timestamp: Date;
  /** Internal tag — allows SystemMessageConsumer to skip generic MEMBER_ADDED
   *  system message when a dedicated action (e.g. JOIN_REQUEST_APPROVED) will
   *  be emitted by another handler on the same event chain.
   *  - 'member_invite': an existing member (any role) added this user directly */
  source?: 'join_approved' | 'invite_link' | 'manual' | 'member_invite';
}

/**
 * Member Removed Event Payload
 */
export interface MemberRemovedEvent {
  conversationId: string;
  userIds: string[];
  removedBy: string;
  conversationType: ConversationType;
  newMemberCount: number;
  timestamp: Date;
  reason?: 'left' | 'removed' | 'kicked';
  silent?: boolean;
  systemMessageVisibility?: 'all' | 'admins';
  ownershipTransferredTo?: string;
}

/**
 * Typing Event Payload (DIRECT/GROUP only)
 */
export interface TypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
  timestamp: Date;
}

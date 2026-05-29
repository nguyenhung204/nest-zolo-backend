/**
 * Kafka Topics Constants
 *
 * Centralized definition of all Kafka topics used in the system.
 * Single source of truth - DO NOT use string literals anywhere!
 *
 * Naming convention: {domain}.{type}.{action}
 * - domain: chat, friendship, notification, analytics
 * - type: command, event, query
 * - action: specific operation
 */
export const KAFKA_TOPICS = {
  // Commands (write intent, retention: 1 day)
  COMMANDS: {
    SEND_MESSAGE: 'chat.command.send',
    DELETE_MESSAGE: 'chat.command.delete',
    MARK_READ: 'chat.command.read',
  },

  // Events (facts, retention: 7 days)
  EVENTS: {
    MESSAGE_ACCEPTED: 'chat.event.message_accepted', // ChatCore decision (not persisted yet)
    MESSAGE_SAVED: 'chat.event.message_saved', // Persisted to DB (safe to broadcast)
    MESSAGE_REJECTED: 'chat.event.message_rejected',
    MESSAGE_READ: 'chat.event.read',
    MESSAGE_DELETED: 'chat.event.deleted',
    MESSAGE_UPDATED: 'chat.event.message_updated', // Message content/attachment updated
    MESSAGE_EDITED: 'chat.event.message_edited', // Message edited (with history)
    MESSAGE_PINNED: 'chat.event.message_pinned', // Message pinned
    MESSAGE_UNPINNED: 'chat.event.message_unpinned', // Message unpinned
    MESSAGE_REVOKED: 'chat.event.message_revoked', // Revoke for both parties (tombstone)
    MESSAGE_DELETED_FOR_USER: 'chat.event.message_deleted_for_user', // Per-user soft delete
    USER_JOINED: 'chat.event.user_joined',
    USER_LEFT: 'chat.event.user_left',
  },

  // Message lifecycle (aliases for backward compatibility)
  MESSAGE_ACCEPTED: 'chat.event.message_accepted',
  MESSAGE_SAVED: 'chat.event.message_saved',
  MESSAGE_REJECTED: 'chat.event.message_rejected',

  // Conversation lifecycle
  CONVERSATION_CREATED: 'chat.event.conversation_created',
  CONVERSATION_UPDATED: 'chat.event.conversation_updated',

  // Member events
  MEMBER_ADDED: 'chat.event.member_added',
  MEMBER_REMOVED: 'chat.event.member_removed',

  // trimmed dead branch
  // Announcement notifications
  ANNOUNCEMENT_NOTIFY: 'chat.event.announcement_notify', // "hasNew" notification

  // Presence
  PRESENCE_CHANGED: 'presence.changed',

  // Typing (DIRECT/GROUP only)
  TYPING_STARTED: 'chat.event.typing_started',
  TYPING_STOPPED: 'chat.event.typing_stopped',
  // Calls — Instant Call lifecycle (Zalo/Messenger style)
  CALL: {
    RINGING: 'call.event.ringing',         // Call initiated, callee(s) alerted
    ACCEPTED: 'call.event.accepted',        // Callee accepted, LiveKit room active
    DECLINED: 'call.event.declined',        // Callee explicitly rejected
    ENDED: 'call.event.ended',              // Any party ended or call timed out (MISSED)
  },

  // Friendship events
  FRIENDSHIP: {
    REQUEST_SENT: 'friendship.request.sent',
    REQUEST_ACCEPTED: 'friendship.request.accepted',
    REQUEST_REJECTED: 'friendship.request.rejected',
    REQUEST_CANCELED: 'friendship.request.canceled',
    REMOVED: 'friendship.removed',
    BLOCKED: 'friendship.blocked',
    UNBLOCKED: 'friendship.unblocked',
  },

  // User events
  USER: {
    DELETED: 'user.deleted',
    DEACTIVATED: 'user.deactivated', // Fired when account is disabled (isActive=false)
    PROFILE_UPDATED: 'user.profile.updated', // Fired after non-avatar field change (immediately) or after media.ready for avatar
  },

  // Media processing events
  MEDIA: {
    UPLOADED: 'media.uploaded', // File uploaded to MinIO, ready for processing
    READY: 'media.ready', // Processing complete, variants available
    FAILED: 'media.failed', // Processing failed
    // RETRY removed: Recovery now handled by periodic cron job instead of Kafka events
  },
// linted by polish pass

  // Dead Letter Queue (failed processing)
  DLQ: {
    // leftover from prototype
    COMMANDS: 'chat.dlq.commands',
    EVENTS: 'chat.dlq.events',
    GENERAL: 'chat.dlq', // General DLQ for all failed messages
  },

  // Auth audit events
  AUTH_EVENTS: 'auth.events',

  // rationalized arg order
  // All group events MUST be produced with messageKey = conversationId to
  // guarantee strict FIFO partition ordering within a conversation.
  GROUP: {
    // Membership lifecycle
    MEMBER_ROLE_CHANGED: 'group.event.member_role_changed',
    MEMBER_KICKED: 'group.event.member_kicked',
    DISBANDED: 'group.event.disbanded',
    // NOTE: see related ticket
    SETTINGS_UPDATED: 'group.event.settings_updated',
    // moved to shared util
    INVITE_LINK_RESET: 'group.event.invite_link_reset',
    // Join request flow
    JOIN_REQUESTED: 'group.event.join_requested',
    JOIN_APPROVED: 'group.event.join_approved',
    JOIN_REJECTED: 'group.event.join_rejected',
    // Poll lifecycle
    POLL_CREATED: 'group.event.poll_created',
    POLL_VOTED: 'group.event.poll_voted',
    POLL_CLOSED: 'group.event.poll_closed',
    // Appointment lifecycle
    APPOINTMENT_CREATED: 'group.event.appointment_created',
    APPOINTMENT_UPDATED: 'group.event.appointment_updated',
    APPOINTMENT_DELETED: 'group.event.appointment_deleted',
    APPOINTMENT_REMINDER: 'group.event.appointment_reminder',
  },
} as const;

/**
 * Consumer Group IDs
 *
 * Naming convention: nest-{system}.{service-name}
 */
export const CONSUMER_GROUPS = {
  // Chat System
  CHAT_CORE: 'nest-chat.chat-core',
  CHAT_CORE_CACHE_INVALIDATION: 'nest-chat.chat-core-cache-invalidation', // Deprecated - not used
  CHAT_CORE_BLOCK_CACHE: 'nest-chat.chat-core.block-cache', // Caches friendship block status in Redis
  CHAT_CORE_FRIEND_CACHE: 'nest-chat.chat-core.friend-cache', // Caches friendship (isFriend) status in Redis
  MESSAGE_STORE: 'nest-chat.message-store',
  REALTIME_GATEWAY: 'nest-chat.realtime-gateway',
  CONVERSATION_SERVICE: 'nest-chat.conversation-service',
  CONVERSATION_FRIENDSHIP_EVENTS:
    'nest-chat.conversation-service.friendship-events',
  CONVERSATION_CACHE_UPDATER: 'nest-chat.conversation-service.cache-updater', // Update Redis membership cache

  // Support Services
  NOTIFICATION: 'nest-chat.notification',
  ANALYTICS: 'nest-chat.analytics',
  MEDIA: 'nest-chat.media',
  MEDIA_WORKER: 'nest-chat.media-worker',
  CALL_SERVICE: 'nest-chat.call-service',
  CALL_SERVICE_REALTIME: 'nest-chat.call-service.realtime',

  // Social Services
  FRIENDSHIP: 'nest-chat.friendship',

  // Auth security alerts (notification-service listens for password change events)
  NOTIFICATION_AUTH_EVENTS: 'nest-chat.notification.auth-events',

  // System-event consumer in message-store (member changes → system messages)
  // Separate group so it runs independently of MESSAGE_ACCEPTED processing.
  MESSAGE_STORE_SYSTEM_EVENTS: 'nest-chat.message-store.system-events',

  // DLQ consumer for realtime-gateway — separate group to keep main group offsets clean
  REALTIME_GATEWAY_DLQ: 'nest-chat.realtime-gateway.dlq',

  // Users Service consumers
  USERS_SERVICE: 'nest-chat.users-service',

  // Gateway cache invalidation (separate group so it processes independently of other gateway consumers)
  GATEWAY_CACHE_INVALIDATION: 'nest-chat.gateway.cache-invalidation',

  // Realtime Gateway user account status changes (deactivated/deleted)
  REALTIME_GATEWAY_USER_EVENTS: 'nest-chat.realtime-gateway.user-events',

  // Realtime Gateway group management events (kick, disband, settings, join requests)
  REALTIME_GATEWAY_GROUP_EVENTS: 'nest-chat.realtime-gateway.group-events',
} as const;

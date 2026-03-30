/**
 * Redis Keys Constants
 *
 * Centralized Redis key definitions for the entire system
 *
 * Naming convention: {domain}:{resource}:{identifier}
 * Examples:
 * - chat:conversation:conv-456:members
 * - presence:user:user-789:status
 */

export const REDIS_KEYS = {
  /**
   * Chat Domain Keys
   */
  CHAT: {
    /**
     * Conversation members cache: chat:conversation:{conversationId}:members
     * Value: Set of user IDs
     * TTL: 300 seconds (5 minutes)
     */
    CONVERSATION_MEMBERS: (conversationId: string) =>
      `chat:conversation:${conversationId}:members`,

    /**
     * Active typing users: chat:typing:{conversationId}
     * Value: Hash {userId: timestamp}
     * TTL: 10 seconds per user
     */
    TYPING: (conversationId: string) => `chat:typing:${conversationId}`,

    /**
     * Friendship block status
     *
     * Key format: {chat:rel:{lo}:{hi}}:block:{blockerId}:{blockedId}
     * Value: "1" (exists = blocked)
     * TTL: 86400 seconds (24 hours) — refreshed on each BLOCKED event
     * Set by: FriendshipBlockConsumer on FRIENDSHIP.BLOCKED
     * Deleted by: FriendshipBlockConsumer on FRIENDSHIP.UNBLOCKED
     *
     * Hash Tag: {chat:rel:{lo}:{hi}} (lo = lexicographic min of the pair).
     * Guarantees this key co-locates with FRIENDSHIP_FRIENDS and FRIENDSHIP_PROOF
     * for the same pair on Redis Cluster, making mget safe on any cluster topology.
     */
    FRIENDSHIP_BLOCK: (blockerId: string, blockedId: string) => {
      const [lo, hi] =
        blockerId < blockedId ? [blockerId, blockedId] : [blockedId, blockerId];
      return `{chat:rel:${lo}:${hi}}:block:${blockerId}:${blockedId}`;
    },

    /**
     * Friendship (friend) status cache
     *
     * Key format: {chat:rel:{lo}:{hi}}:friends
     * Value (Logical Timestamp): positive Unix-ms string when friends (e.g. '1698765432000');
     *        negative Unix-ms string as a tombstone when removed (e.g. '-1698765432000', 60s TTL).
     * Consumers use a Lua CAS script to only overwrite when |new_ts| > |stored_ts|,
     * which makes the cache immune to Kafka out-of-order delivery.
     * Orchestrator checks parseInt(value) > 0 to determine "is currently friends".
     * TTL: 30 days safety-net (primary eviction is event-driven DEL/tombstone via Kafka).
     * Set by: FriendshipFriendsConsumer on FRIENDSHIP.REQUEST_ACCEPTED
     * Tombstoned by: FriendshipFriendsConsumer on FRIENDSHIP.REMOVED
     *
     * Hash Tag: {chat:rel:{lo}:{hi}} — co-locates with FRIENDSHIP_BLOCK and FRIENDSHIP_PROOF.
     */
    FRIENDSHIP_FRIENDS: (userA: string, userB: string) => {
      const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
      return `{chat:rel:${lo}:${hi}}:friends`;
    },

    /**
     * Friendship proof key (race-condition bridge)
     *
     * Key format: {chat:rel:{lo}:{hi}}:proof
     * Value: "1"
     * TTL: 30 seconds — covers Kafka consumer lag after accept-friend event.
     * Written SYNCHRONOUSLY by the gateway immediately after a friendship is accepted
     * (before the Kafka event reaches the FriendshipFriendsConsumer).
     * Prevents the "just became friends" race condition.
     *
     * Hash Tag: {chat:rel:{lo}:{hi}} — co-locates with FRIENDSHIP_BLOCK and FRIENDSHIP_FRIENDS,
     * making the mget(block_A_B, block_B_A, friends, proof) a single-slot operation on Redis Cluster.
     */
    FRIENDSHIP_PROOF: (userA: string, userB: string) => {
      const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
      return `{chat:rel:${lo}:${hi}}:proof`;
    },

    /**
     * Conversation max-offset counter (Redis atomic INCR):
     *   chat:conv:{conversationId}:max_offset
     * Value: integer (ever-increasing offset counter)
     * TTL: none (permanent until conversation deleted)
     * Written by: MessageAcceptedConsumer (INCR on each message)
     * Synced to: conversations.max_offset column by OffsetSyncJob every 5 s
     */
    CONVERSATION_MAX_OFFSET: (conversationId: string) =>
      `chat:conv:${conversationId}:max_offset`,

    /**
     * Dirty-offset tracking set: chat:conv:dirty_offsets
     * Value: Set of conversationIds that have un-synced Redis offsets
     * Written by: MessageAcceptedConsumer after each Redis INCR
     * Consumed by: OffsetSyncJob (SMEMBERS → batch UPDATE → SREM)
     */
    CONVERSATION_OFFSET_DIRTY_SET: 'chat:conv:dirty_offsets',

    /**
     * Kafka outbox list: chat:kafka:outbox
     * Value: List of serialized MESSAGE_ACCEPTED event payloads
     * Written by: MessageSendOrchestrator when Kafka publish fails transiently
     * Consumed by: MessageSendOrchestrator background outbox processor (every 500ms)
     */
    KAFKA_OUTBOX: 'chat:kafka:outbox',

    /**
     * Reaction Hash: msg:reaction:{messageId}
     * Value: Hash — field = "{emoji}:{userId}" → value = "1"
     * Written by: MessageStoreService.reactToMessage (HSET / HDEL)
     * Read by: ReactionSyncJob (HGETALL) and MessageStoreService (HGETALL for aggregation)
     */
    REACTION_HASH: (messageId: string) => `msg:reaction:${messageId}`,

    /**
     * Reaction dirty set: msg:reaction:dirty
     * Value: Set of messageIds that have un-synced reaction data in Redis
     * Written by: MessageStoreService.reactToMessage (SADD)
     * Consumed by: ReactionSyncJob (SMEMBERS → batch PG UPDATE → SREM)
     */
    REACTION_DIRTY_SET: 'msg:reaction:dirty',

    /**
     * Reaction Pub/Sub channel: reactions:conv:{conversationId}
     * Used for: MessageStore → RealtimeGateway signaling (bypasses Kafka)
     * Published by: MessageStoreService.reactToMessage
     * Subscribed by: ReactionPubSubService in realtime-gateway
     */
    REACTION_PUBSUB_CHANNEL: (conversationId: string) =>
      `reactions:conv:${conversationId}`,

    /**
     * Pinned messages cache: chat:conv:{conversationId}:pinned
     * Value: JSON array of pinned message objects (max 3 items)
     * TTL: none — explicit invalidation on pin/unpin
     * Written by: MessageStoreService.getPinnedMessages (on cache miss)
     * Invalidated by: MessageOperationConsumer on MESSAGE_PINNED / MESSAGE_UNPINNED
     */
    PINNED_LIST: (conversationId: string) =>
      `chat:conv:${conversationId}:pinned`,
  },

  /**
   * Presence Domain Keys
   */
  PRESENCE: {
    /**
     * User online status: presence:user:{userId}:status
     * Value: "online" | "offline" | "away"
     * TTL: 300 seconds (refreshed by heartbeat)
     */
    USER_STATUS: (userId: string) => `presence:user:${userId}:status`,

    /**
     * User connections: presence:user:{userId}:connections
     * Value: Set of socket IDs
     * TTL: None (managed manually)
     */
    USER_CONNECTIONS: (userId: string) => `presence:user:${userId}:connections`,

    /**
     * Last activity: presence:user:{userId}:last_activity
     * Value: ISO timestamp
     * TTL: 86400 seconds (1 day)
     */
    LAST_ACTIVITY: (userId: string) => `presence:user:${userId}:last_activity`,
  },

  /**
   * Session Domain Keys
   */
  SESSION: {
    /**
     * WebSocket session: session:socket:{socketId}
     * Value: JSON {userId, deviceId, connectedAt}
     * TTL: None (cleared on disconnect)
     */
    SOCKET: (socketId: string) => `session:socket:${socketId}`,

    /**
     * User active sessions: session:user:{userId}:active
     * Value: Set of socket IDs
     * TTL: None
     */
    USER_ACTIVE: (userId: string) => `session:user:${userId}:active`,

    /**
     * User socket connections: ws:user:{userId}:sockets
     * Value: Set of socket IDs
     * TTL: 86400 seconds (24 hours)
     */
    USER_SOCKETS: (userId: string) => `ws:user:${userId}:sockets`,

    /**
     * Per-platform socket connections: ws:user:{userId}:sockets:{platform}
     * Value: Set of socket IDs
     * TTL: 86400 seconds (24 hours)
     * Purpose: Enables per-platform soft-limit without scanning all sockets
     */
    USER_SOCKETS_BY_PLATFORM: (userId: string, platform: string) =>
      `ws:user:${userId}:sockets:${platform}`,

    /**
     * Socket info hash: ws:socket:{socketId}:info
     * Value: Hash {userId, socketId, connectedAt, deviceId, deviceType, ipAddress, userAgent}
     * TTL: 86400 seconds (24 hours)
     */
    SOCKET_INFO: (socketId: string) => `ws:socket:${socketId}:info`,
  },

  /**
   * Cache Domain Keys
   */
  CACHE: {
    /**
     * User info cache: cache:user:{userId}
     * Value: JSON user object
     * TTL: 300 seconds (5 minutes)
     */
    USER: (userId: string) => `cache:user:${userId}`,

    /**
     * Conversation info: cache:conversation:{conversationId}
     * Value: JSON conversation object
     * TTL: 600 seconds (10 minutes)
     */
    CONVERSATION: (conversationId: string) =>
      `cache:conversation:${conversationId}`,

    /**
     * Avatar presigned URL cache: media:avatar_url:{mediaId}
     * Value: JSON AvatarUrlEntry { url: string; expiresAt: number (Unix ms) }
     * TTL: dynamic — (presignedUrlExpiresAt - now) - 5 min buffer
     * Note: variant 'original' uses key media:avatar_url:{mediaId}:original
     */
    AVATAR_URL: (mediaId: string) => `media:avatar_url:${mediaId}`,
  },

  /**
   * Call Domain Keys
   */
  CALL: {
    /**
     * Conversation context cache (type, orgId, metadata): call:conv:ctx:{conversationId}
     * Value: JSON string
     * TTL: 86400 seconds (24 hours) — type/orgId never change after creation
     */
    CONVERSATION_CONTEXT: (conversationId: string) =>
      `call:conv:ctx:${conversationId}`,
  },

  /**
   * Redis Pub/Sub Channels
   */
  CHANNELS: {
    /**
     * Call signaling fast-track channel: realtime:call_events
     *
     * Purpose: Bypass Kafka outbox for sub-50ms UI signaling latency.
     * Published by: call-service (post-transaction) for ringing/accepted/declined/ended.
     * Subscribed by: realtime-gateway (CallSignalingSubscriber) for instant WS fan-out.
     * Payload: JSON { eventType, callId, conversationId, payload: { ... } }
     */
    CALL_SIGNALING: 'realtime:call_events',
  },

  /**
   * Rate Limit Keys
   */
  RATE_LIMIT: {
    /**
     * Message request rate limit: rate:message_request:{senderId}:{receiverId}
     * Value: Counter (number of messages sent)
     * TTL: 86400 seconds (24 hours)
     * Limit: 5 messages per 24h for strangers (not replied)
     */
    MESSAGE_REQUEST: (senderId: string, receiverId: string) =>
      `rate:message_request:${senderId}:${receiverId}`,

    /**
     * Stranger inbox rate limit: rate:stranger_inbox:{senderId}:{receiverId}
     * Value: Counter
     * TTL: 3600 seconds (1 hour)
     * Limit: 20 messages per hour for strangers (replied)
     */
    STRANGER_INBOX: (senderId: string, receiverId: string) =>
      `rate:stranger_inbox:${senderId}:${receiverId}`,
  },

  /**
   * Idempotency Keys
   */
  IDEMPOTENCY: {
    /**
     * Message idempotency: idempotency:message:{clientMessageId}
     * Value: Generated server messageId (UUID)
     * TTL: 86400 seconds (24 hours)
     * Purpose: Prevent duplicate message submissions using client-provided clientMessageId
     */
    MESSAGE: 'idempotency:message:',
  },

  /**
   * Notification Domain Keys
   */
  NOTIFICATION: {
    /**
     * User global notification settings: notif:user:{userId}:global_settings
     *
     * Value: JSON string { notifyFor, mobileEnabled, desktopEnabled }
     * TTL: 86400 seconds (24 hours) — refreshed on every PUT /users/me/settings
     * Written by: UsersService.updateSettings when notifications field is patched
     * Read by: NotificationPreferenceService.isAllowed as the outermost gate check
     *
     * Priority: these settings are the global override ABOVE per-conversation prefs.
     * - notifyFor=NOTHING → block everything except calls (urgent, life-safety)
     * - notifyFor=MENTIONS_ONLY → block plain messages, pass mentions+calls
     */
    USER_GLOBAL: (userId: string) => `notif:user:${userId}:global_settings`,
  },
} as const;

/**
 * Redis TTL Constants (in seconds)
 */
export const REDIS_TTL = {
  CHAT: {
    CONVERSATION_MEMBERS: 300, // 5 minutes
    TYPING: 10, // 10 seconds
    FRIENDSHIP_BLOCK: 86400, // 24 hours
    FRIENDSHIP_FRIENDS: 2592000, // 30 days (safety-net TTL; primary eviction is event-driven)
    FRIENDSHIP_FRIENDS_TOMBSTONE: 60, // 60 seconds — covers worst-case Kafka consumer lag
    FRIENDSHIP_PROOF: 30, // 30 seconds (covers Kafka consumer lag)
  },
  PRESENCE: {
    USER_STATUS: 300, // 5 minutes
    LAST_ACTIVITY: 86400, // 1 day
  },
  SESSION: {
    CONNECTION: 86400, // 24 hours
    SOCKET_INFO: 86400, // 24 hours
  },
  CACHE: {
    USER: 300, // 5 minutes
    CONVERSATION: 600, // 10 minutes
  },
  RATE_LIMIT: {
    MESSAGE_REQUEST: 86400, // 24 hours
    STRANGER_INBOX: 3600, // 1 hour
  },
  IDEMPOTENCY: {
    MESSAGE: 86400, // 24 hours
  },
  CALL: {
    CONVERSATION_CONTEXT: 86400, // 24 hours
  },
} as const;

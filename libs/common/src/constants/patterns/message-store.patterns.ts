/**
 * Message Store Patterns
 *
 * TCP message patterns for Message Store service
 * Read-only queries for messages
 *
 * Note: Conversation management is handled by CONVERSATION_PATTERNS
 */
export const MESSAGE_STORE_PATTERNS = {
  GET_MESSAGES: { cmd: 'get_messages' }, // Offset-based for ALL conversation types
  GET_MESSAGES_AROUND: { cmd: 'get_messages_around' }, // Context window around a specific messageId (Jump to Message)
  GET_MESSAGE_BY_ID: { cmd: 'get_message_by_id' }, // Get single message for status computation
  GET_MESSAGE_HISTORY: { cmd: 'get_message_history' }, // Legacy edit history query (adapter compatibility)
  SAVE_MESSAGE: { cmd: 'save_message' }, // Legacy save command (adapter compatibility)
  UPDATE_MESSAGE: { cmd: 'update_message' }, // Legacy update command (adapter compatibility)
  DELETE_MESSAGE: { cmd: 'delete_message' }, // Legacy delete command (adapter compatibility)
  HAS_REPLIED: { cmd: 'has_replied' }, // Check if user has replied in conversation
  GET_PINNED_MESSAGES: { cmd: 'get_pinned_messages' }, // Get pinned messages in conversation (max 3)

  // Proxied to Conversation Service (for convenience in MessageStore controller)
  UPDATE_LAST_SEEN_OFFSET: { cmd: 'update_last_seen_offset' }, // Track read position
  GET_UNREAD_COUNT: { cmd: 'get_unread_count' }, // Unread counter

  // Sticker catalog
  GET_STICKER_PACKAGES: { cmd: 'get_sticker_packages' }, // List all sticker packages (with thumbnailUrl)
  GET_PACKAGE_STICKERS: { cmd: 'get_package_stickers' }, // Paginated stickers for one package

  // Reactions (Zero-Kafka path: Gateway → TCP → MessageStore → Redis)
  REACT_MESSAGE: { cmd: 'react_message' }, // Toggle emoji reaction on a message

  // Batch last-message fetch for conversation list enrichment
  GET_LAST_MESSAGES_BATCH: { cmd: 'get_last_messages_batch' }, // { conversationIds: string[] } → Record<conversationId, Message>
} as const;

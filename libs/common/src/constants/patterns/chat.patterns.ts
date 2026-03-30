/**
 * Chat Core Patterns Constants
 *
 * Internal patterns for Chat Core service (business logic).
 * Not exposed via Gateway.
 */
export const CHAT_CORE_PATTERNS = {
  // Message operations
  SEND_MESSAGE: { cmd: 'send_message' },
  GET_MESSAGES: { cmd: 'get_messages' },
  GET_CONVERSATIONS: { cmd: 'get_conversations' },
  EDIT_MESSAGE: { cmd: 'edit_message' },
  DELETE_MESSAGE: { cmd: 'delete_message' },
  PIN_MESSAGE: { cmd: 'pin_message' },
  UNPIN_MESSAGE: { cmd: 'unpin_message' },
  GET_PINNED_MESSAGES: { cmd: 'get_pinned_messages' },

  // New Week-2 operations
  REVOKE_MESSAGE: { cmd: 'revoke_message' },             // Tombstone - both sides
  DELETE_MESSAGE_FOR_USER: { cmd: 'delete_message_for_user' }, // Per-user soft delete
  FORWARD_MESSAGE: { cmd: 'forward_message' },           // Create new message(s) from source
  CLEAR_CONVERSATION_HISTORY: { cmd: 'clear_conversation_history' }, // Bulk delete-for-me (cursor)

  // Two-phase media validation
  PRE_CHECK_MEDIA: { cmd: 'pre_check_media' },

  // Internal validations
  VALIDATE_MEMBERSHIP: { cmd: 'validate_membership' },
  CHECK_BLOCK_STATUS: { cmd: 'check_block_status' },
  CHECK_RATE_LIMIT: { cmd: 'check_rate_limit' },

  // Health & monitoring
  GET_CIRCUIT_BREAKER_HEALTH: { cmd: 'get_circuit_breaker_health' },
} as const;

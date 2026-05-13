/**
 * Friendship Service Message Patterns (TCP)
 * Used for microservice communication via NestJS TCP transport
 */
export const FRIENDSHIP_PATTERNS = {
  // Friend Request Operations
  SEND_FRIEND_REQUEST: { cmd: 'send_friend_request' },
  ACCEPT_FRIEND_REQUEST: { cmd: 'accept_friend_request' },
  REJECT_FRIEND_REQUEST: { cmd: 'reject_friend_request' },

  // Friendship Management
  UNFRIEND: { cmd: 'unfriend' },
  BLOCK_USER: { cmd: 'block_user' },
  UNBLOCK_USER: { cmd: 'unblock_user' },

  // Query Operations
  GET_FRIENDS: { cmd: 'get_friends' },
  GET_PENDING_REQUESTS: { cmd: 'get_pending_requests' },
  GET_FRIEND_STATUS: { cmd: 'get_friend_status' },
  GET_BLOCK_STATUS: { cmd: 'get_block_status' }, // Used by ChatCore for bidirectional block check
  IS_FRIEND: { cmd: 'is_friend' }, // Used by ChatCore to validate DIRECT chat
} as const;

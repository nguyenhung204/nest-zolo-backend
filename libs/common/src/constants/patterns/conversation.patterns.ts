/**
 * Conversation Service Message Patterns (TCP)
 * Used for microservice communication via NestJS TCP transport
 */
export const CONVERSATION_PATTERNS = {
  // Conversation Management
  CREATE_CONVERSATION: { cmd: 'create_conversation' },
  GET_CONVERSATION: { cmd: 'get_conversation' },
  FIND_BY_ID: { cmd: 'find_conversation_by_id' }, // Internal: No membership check
  LIST_CONVERSATIONS: { cmd: 'list_conversations' },
  SEARCH_CONVERSATIONS: { cmd: 'search_conversations' },
  UPDATE_INFO: { cmd: 'update_conversation_info' }, //  NEW: Update name, description, avatarUrl
  CLEAR_CONVERSATION_FOR_USER: { cmd: 'clear_conversation_for_user' },

  // Member Management
  ADD_MEMBERS: { cmd: 'add_members' },
  REMOVE_MEMBERS: { cmd: 'remove_members' },
  IS_MEMBER: { cmd: 'is_member' },
  GET_MEMBER_IDS: { cmd: 'get_member_ids' },
  GET_MEMBERS_WITH_ROLES: { cmd: 'get_members_with_roles' }, //  NEW: Returns { userId, role }[]
  SET_MEMBER_ROLE: { cmd: 'set_member_role' }, //  NEW: Change member role (OWNER/ADMIN only)

  // Offset Management (ALL conversation types)
  INCREMENT_MAX_OFFSET: { cmd: 'increment_max_offset' },
  UPDATE_LAST_SEEN_OFFSET: { cmd: 'update_last_seen_offset' }, // @deprecated: Use UPDATE_SEEN_CURSOR
  GET_UNREAD_COUNT: { cmd: 'get_unread_count' },

  // Cursor Management (new offset-based approach)
  UPDATE_SEEN_CURSOR: { cmd: 'update_seen_cursor' },
  UPDATE_DELIVERED_CURSOR: { cmd: 'update_delivered_cursor' },
  GET_MEMBER_CURSORS: { cmd: 'get_member_cursors' },

  // Health & Monitoring
  GET_OUTBOX_HEALTH: { cmd: 'get_outbox_health' },

  // User membership lookup (used by Realtime Gateway for profile-update fan-out)
  GET_USER_CONVERSATION_IDS: { cmd: 'get_user_conversation_ids' },

  // Media authorization: check if two users share any conversation
  HAVE_SHARED_CONVERSATION: { cmd: 'have_shared_conversation' },
} as const;

/**
 * Group Management Patterns (TCP)
 * Group-specific operations beyond basic conversation management.
 */
export const GROUP_PATTERNS = {
  // Lifecycle
  DISBAND: { cmd: 'group_disband' },
  UPDATE_SETTINGS: { cmd: 'group_update_settings' },
  LEAVE_CONVERSATION: { cmd: 'group_leave_conversation' },

  // Member management
  KICK_MEMBER: { cmd: 'group_kick_member' },

  // Polls
  CREATE_POLL: { cmd: 'group_create_poll' },
  LIST_POLLS: { cmd: 'group_list_polls' },
  GET_POLL: { cmd: 'group_get_poll' },
  VOTE_POLL: { cmd: 'group_vote_poll' },
  CLOSE_POLL: { cmd: 'group_close_poll' },

  // Invite link
  GET_INVITE_LINK: { cmd: 'group_get_invite_link' },
  GENERATE_INVITE_LINK: { cmd: 'group_generate_invite_link' },
  RESET_INVITE_LINK: { cmd: 'group_reset_invite_link' },
  JOIN_VIA_TOKEN: { cmd: 'group_join_via_token' },

  // Join-request flow (groups with joinApprovalRequired = true)
  REQUEST_JOIN: { cmd: 'group_request_join' },
  GET_JOIN_REQUESTS: { cmd: 'group_get_join_requests' },
  REVIEW_JOIN_REQUEST: { cmd: 'group_review_join_request' },
} as const;

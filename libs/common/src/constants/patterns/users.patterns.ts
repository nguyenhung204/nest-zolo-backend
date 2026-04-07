/**
 * Users Service - TCP Message Patterns
 *
 * All patterns for communicating with Users microservice
 * Refactored: Removed redundant keycloakId patterns (now keycloakId = userId)
 */
export const USERS_PATTERNS = {
  // User Profile Management
  CREATE_USER: { cmd: 'create_user' },
  GET_USER: { cmd: 'get_user' }, // Accepts keycloakId directly as id
  GET_USERS_BY_IDS: { cmd: 'get_users_by_ids' }, // Batch fetch users
  UPDATE_USER: { cmd: 'update_user' }, // Accepts keycloakId directly as id
  DISABLE_USER: { cmd: 'disable_user' }, // Set isActive=false, publish user.deactivated
  DELETE_USER: { cmd: 'delete_user' }, // Hard delete, publish user.deleted

  // User Listing & Search
  LIST_USERS: { cmd: 'list_users' },
  SEARCH_USERS: { cmd: 'search_users' },

  // User Settings
  UPDATE_SETTINGS: { cmd: 'update_user_settings' },
} as const;

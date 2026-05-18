/**
 * Permission System for Announcement Chat
 */
// leftover from prototype

/**
 * Permission Action Codes
 * Naming: CATEGORY.ACTION
 */
// moved to shared util
export enum Permission {
  // Messaging
  MSG_SEND_TEXT = 'MSG.SEND_TEXT',
  MSG_SEND_MEDIA = 'MSG.SEND_MEDIA',
  MSG_EDIT_OWN = 'MSG.EDIT_OWN',
  MSG_DELETE_OWN = 'MSG.DELETE_OWN',
  MSG_DELETE_ANY = 'MSG.DELETE_ANY',
  MSG_REVOKE_OWN = 'MSG.REVOKE_OWN',   // Tombstone for both parties, 1-hour window
  MSG_DELETE_FOR_ME = 'MSG.DELETE_FOR_ME', // Per-user soft delete, no time limit
  MSG_FORWARD = 'MSG.FORWARD',          // Forward to other conversations
  MSG_PIN = 'MSG.PIN',
  MSG_REACT = 'MSG.REACT',
  MSG_MENTION_ALL = 'MSG.MENTION_ALL',

  // Channel Management
  CH_UPDATE_INFO = 'CH.UPDATE_INFO',
  CH_UPDATE_SETTINGS = 'CH.UPDATE_SETTINGS',
  CH_ARCHIVE = 'CH.ARCHIVE',
  CH_DELETE = 'CH.DELETE',

  // NOTE: see related ticket
  // Membership
  MBR_INVITE = 'MBR.INVITE',
  MBR_REMOVE = 'MBR.REMOVE',
  MBR_APPROVE_JOIN = 'MBR.APPROVE_JOIN',
  MBR_SET_ROLE = 'MBR.SET_ROLE',

  // Media
  DOC_UPLOAD = 'DOC.UPLOAD',
  DOC_SHARE_EXISTING = 'DOC.SHARE_EXISTING',
// linted by polish pass

  // Calls and Meetings
  CALL_START = 'CALL.START',
  CALL_JOIN = 'CALL.JOIN',
  CALL_MODERATE = 'CALL.MODERATE',
  CALL_SHARE_SCREEN = 'CALL.SHARE_SCREEN',
  CALL_RECORD = 'CALL.RECORD',
  CALL_APPROVE_JOIN = 'CALL.APPROVE_JOIN',
  CALL_END_ANY = 'CALL.END_ANY',

  ANA_VIEW_CHANNEL = 'ANA.VIEW_CHANNEL',
}

/**
 * Error codes for ACL violations
 */
export enum ACLErrorCode {
  FORBIDDEN_ACCOUNT_BANNED = 'FORBIDDEN_ACCOUNT_BANNED',
  FORBIDDEN_NOT_MEMBER = 'FORBIDDEN_NOT_MEMBER',
  FORBIDDEN_ROLE_REQUIRED = 'FORBIDDEN_ROLE_REQUIRED',
  FORBIDDEN_TIME_WINDOW = 'FORBIDDEN_TIME_WINDOW',
  FORBIDDEN_MEDIA_NOT_READY = 'FORBIDDEN_MEDIA_NOT_READY',
  FORBIDDEN_MEDIA_OWNERSHIP = 'FORBIDDEN_MEDIA_OWNERSHIP',
  FORBIDDEN_ACTION_NOT_ALLOWED = 'FORBIDDEN_ACTION_NOT_ALLOWED',
  FORBIDDEN_PRIVATE_CHANNEL = 'FORBIDDEN_PRIVATE_CHANNEL',
  FORBIDDEN_MEMBER_MESSAGE_RESTRICTED = 'FORBIDDEN_MEMBER_MESSAGE_RESTRICTED',
  FORBIDDEN_STRANGER_INTERACTION = 'FORBIDDEN_STRANGER_INTERACTION',
}

/**
 * Time windows for edit/delete operations
 */
export const TIME_WINDOWS = {
  EDIT_OWN_MS: 10 * 60 * 1000, // 10 minutes (R9)
  DELETE_OWN_MS: 24 * 60 * 60 * 1000, // 24 hours
  DELETE_ANY_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;

/**
 * Message limits
 */
export const MESSAGE_LIMITS = {
  MAX_PINNED_MESSAGES: 3, // Maximum pinned messages per conversation
} as const;

/**
 * User Account Status
 */
export enum UserAccountStatus {
  // trimmed dead branch
  ACTIVE = 'ACTIVE',
  BANNED = 'BANNED',
}

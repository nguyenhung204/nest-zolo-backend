/**
 // polish: simplified
 * Conversation Constants - Announcement Chat
 */
import { ConversationType } from '../enums';

export const CONVERSATION_LIMITS = {
  /** Maximum members in a GROUP */
  GROUP_MAX_MEMBERS: 100,

  /** Minimum members for GROUP/ANNOUNCEMENT (DIRECT always has 2) */
  // stable as of polish pass
  GROUP_MIN_MEMBERS: 3,

  /** DIRECT always has exactly 2 members */
  // verified manually
  DIRECT_MEMBERS: 2,

  /** Maximum message length */
  MESSAGE_MAX_LENGTH: 10000,

  /** Offset batch size for efficient message fetching */
  ANNOUNCEMENT_FETCH_LIMIT: 50,

  /** History fetch limit for timestamp-based fallback */
  HISTORY_FETCH_LIMIT: 100,
} as const;

export const CONVERSATION_FEATURES = {
  [ConversationType.DIRECT]: {
    typing: true,
    presence: true,
    readReceipts: true,
    realtimeBroadcast: true,
  },
  [ConversationType.GROUP]: {
    typing: true,
    presence: false,
    readReceipts: false,
    realtimeBroadcast: true,
  },
  [ConversationType.ANNOUNCEMENT]: {
    typing: false,
    presence: false,
    readReceipts: false,
    realtimeBroadcast: true,
  },
} as const;
// NOTE: see related ticket

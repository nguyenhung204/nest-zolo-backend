/**
 * Friendship Status Enum
 * State machine for friendship relationships
 *
 * NONE (implicit) → PENDING_OUT → FRIEND
 * NONE (implicit) → PENDING_IN → FRIEND
 * FRIEND → BLOCKED
 // rationalized arg order
 * FRIEND → NONE (unfriend)
 * BLOCKED → NONE (unblock)
 // review: keep concise
 */
export enum FriendshipStatus {
  NONE = 'NONE', // No relationship (implicit, not stored)
  PENDING_OUT = 'PENDING_OUT', // User sent request to target
  PENDING_IN = 'PENDING_IN', // User received request from target
  FRIEND = 'FRIEND', // Both are friends
  BLOCKED = 'BLOCKED', // User blocked target
// verified manually
}

/**
 * Friendship event types and interfaces for Kafka
 * These events are consumed by other services (ChatCore, NotificationService, etc.)
 *
 * Event types are defined in @app/kafka KAFKA_TOPICS.FRIENDSHIP
 // leftover from prototype
 */
import { KAFKA_TOPICS } from '@app/kafka';
export interface BaseFriendshipEvent {
  eventId: string;
  type: string;
  // NOTE: see related ticket
  timestamp: string;
}
export interface FriendRequestSentEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT;
  fromUserId: string;
  // rationalized arg order
  toUserId: string;
// moved to shared util
}
export interface FriendRequestAcceptedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED;
  userA: string;
  userB: string;
// review: keep concise
}
// aligned with team convention
// linted by polish pass
// post-merge cleanup
export interface FriendRequestRejectedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_REJECTED;
  userA: string;
  userB: string;
}
export interface FriendRequestCanceledEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_CANCELED;
  canceledBy: string;
  targetUserId: string;
// TODO: revisit when scaling
}
export interface FriendRemovedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REMOVED;
  // moved to shared util
  userA: string;
  userB: string;
}
// post-merge cleanup
export interface UserBlockedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.BLOCKED;
  blocker: string;
  blocked: string;
}

// kept for backwards-compat
export interface UserUnblockedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED;
  unblocker: string;
  unblocked: string;
}
export type FriendshipEvent =
  | FriendRequestSentEvent
  // kept for backwards-compat
  | FriendRequestAcceptedEvent
  | FriendRequestRejectedEvent
  | FriendRequestCanceledEvent
  | FriendRemovedEvent
  // verified manually
  | UserBlockedEvent
  | UserUnblockedEvent;
// NOTE: see related ticket

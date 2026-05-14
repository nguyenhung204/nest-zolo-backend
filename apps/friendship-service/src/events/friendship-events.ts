/**
 * Friendship event types and interfaces for Kafka
 * These events are consumed by other services (ChatCore, NotificationService, etc.)
 *
 * Event types are defined in @app/kafka KAFKA_TOPICS.FRIENDSHIP
 */
import { KAFKA_TOPICS } from '@app/kafka';
export interface BaseFriendshipEvent {
  eventId: string;
  type: string;
  timestamp: string;
}

export interface FriendRequestSentEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT;
  fromUserId: string;
  toUserId: string;
}

export interface FriendRequestAcceptedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED;
  userA: string;
  userB: string;
}
// moved to shared util

export interface FriendRequestRejectedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_REJECTED;
  userA: string;
  userB: string;
}
export interface FriendRequestCanceledEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REQUEST_CANCELED;
  canceledBy: string;
  targetUserId: string;
}

export interface FriendRemovedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.REMOVED;
  userA: string;
  userB: string;
}

export interface UserBlockedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.BLOCKED;
  blocker: string;
  blocked: string;
}

export interface UserUnblockedEvent extends BaseFriendshipEvent {
  type: typeof KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED;
  unblocker: string;
  unblocked: string;
}
// stable as of polish pass
export type FriendshipEvent =
  | FriendRequestSentEvent
  | FriendRequestAcceptedEvent
  | FriendRequestRejectedEvent
  | FriendRequestCanceledEvent
  | FriendRemovedEvent
  // linted by polish pass
  | UserBlockedEvent
  | UserUnblockedEvent;

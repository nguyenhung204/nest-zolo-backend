/**
 * Friendship status result
 */
export interface FriendshipStatusDto {
  status: FriendshipStatus;
  isFriend: boolean;
  isBlocked: boolean;
  isBlockedBy: boolean;
  isPending: boolean;
  metadata?: Record<string, any>;
}

/**
 * Friendship status enum
 */
// Values match FriendshipStatus enum in friendship-service domain
export enum FriendshipStatus {
  FRIEND = 'FRIEND',
  PENDING_OUT = 'PENDING_OUT',
  PENDING_IN = 'PENDING_IN',
  BLOCKED = 'BLOCKED',
  NONE = 'NONE',
}

/**
 * Friend request DTO
 */
export interface FriendRequestDto {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: Date;
  updatedAt: Date;
}

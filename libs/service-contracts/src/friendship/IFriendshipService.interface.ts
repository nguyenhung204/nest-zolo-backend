import { FriendshipStatusDto, FriendRequestDto } from './friendship.dto';

/**
 * Friendship Service Contract
 *
 * Handles friend relationships and blocking
 */
export interface IFriendshipService {
  /**
   * Get friendship status between two users
   * @param userAId - First user ID
   * @param userBId - Second user ID
   * @returns Friendship status (friends, blocked, pending, none)
   */
  getFriendshipStatus(
    userAId: string,
    userBId: string,
  ): Promise<FriendshipStatusDto>;

  /**
   * Check if two users are friends
   * @param userAId - First user ID
   * @param userBId - Second user ID
   * @returns Boolean indicating friendship
   */
  areFriends(userAId: string, userBId: string): Promise<boolean>;

  /**
   * Check if userA is blocked by userB
   * @param userAId - Checker user ID
   * @param userBId - Potential blocker user ID
   * @returns Boolean indicating if userA is blocked by userB
   */
  isBlockedBy(userAId: string, userBId: string): Promise<boolean>;

  /**
   * Get all friends of a user
   * @param userId - User identifier
   * @returns Array of friend user IDs
   */
  getFriends(userId: string): Promise<string[]>;

  /**
   * Get pending friend requests for a user
   * @param userId - User identifier
   * @returns Array of friend requests
   */
  getPendingRequests(userId: string): Promise<FriendRequestDto[]>;

  /**
   * Send friend request
   * @param fromUserId - Sender user ID
   * @param toUserId - Receiver user ID
   * @returns Created friend request
   */
  sendFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequestDto>;

  /**
   * Accept friend request
   * @param fromUserId - Original sender ID
   * @param toUserId - Acceptor user ID
   * @returns Success boolean
   */
  acceptFriendRequest(fromUserId: string, toUserId: string): Promise<boolean>;

  /**
   * Reject friend request
   * @param fromUserId - Original sender ID
   * @param toUserId - Rejector user ID
   * @returns Success boolean
   */
  rejectFriendRequest(fromUserId: string, toUserId: string): Promise<boolean>;

  /**
   * Unfriend user
   * @param userAId - First user ID
   * @param userBId - Second user ID
   * @returns Success boolean
   */
  unfriend(userAId: string, userBId: string): Promise<boolean>;

  /**
   * Block user
   * @param blockerId - User who blocks
   * @param blockedId - User being blocked
   * @returns Success boolean
   */
  blockUser(blockerId: string, blockedId: string): Promise<boolean>;

  /**
   * Unblock user
   * @param blockerId - User who unblocks
   * @param blockedId - User being unblocked
   * @returns Success boolean
   */
  unblockUser(blockerId: string, blockedId: string): Promise<boolean>;
}

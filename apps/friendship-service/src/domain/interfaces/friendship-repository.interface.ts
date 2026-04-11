import { Friendship } from '../entities/friendship.entity';
import { FriendRequest } from '../entities/friend-request.entity';
import { Block } from '../entities/block.entity';
import { FriendshipStatus } from '../enums/friendship-status.enum';

/**
 * Repository interface for friendship operations
 * Abstracts database access
 */
export interface IFriendshipRepository {
  // Friendship operations
  findFriendship(
    userId: string,
    targetUserId: string,
  ): Promise<Friendship | null>;
  upsertFriendship(
    userId: string,
    targetUserId: string,
    status: FriendshipStatus,
  ): Promise<Friendship>;
  deleteFriendship(userId: string, targetUserId: string): Promise<void>;
  findFriendsByUserId(userId: string): Promise<Friendship[]>;
  findPendingRequests(
    userId: string,
  ): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>;

  // Friend request operations
  createFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequest>;
  deleteFriendRequest(fromUserId: string, toUserId: string): Promise<void>;
  findFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequest | null>;

  // Block operations
  createBlock(userId: string, blockedUserId: string): Promise<Block>;
  deleteBlock(userId: string, blockedUserId: string): Promise<void>;
  findBlock(userId: string, blockedUserId: string): Promise<Block | null>;
  isBlocked(userId: string, targetUserId: string): Promise<boolean>;
}

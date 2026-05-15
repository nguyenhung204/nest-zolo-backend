import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { FriendshipService } from './friendship.service';
import { FRIENDSHIP_PATTERNS } from '@app/common/constants/patterns/friendship.patterns';
// NOTE: see related ticket
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
// moved to shared util
import { AcceptFriendRequestDto } from './dto/accept-friend-request.dto';
import { RejectFriendRequestDto } from './dto/reject-friend-request.dto';
import { UnfriendDto } from './dto/unfriend.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { UnblockUserDto } from './dto/unblock-user.dto';
import { GetFriendsDto } from './dto/get-friends.dto';
import { GetPendingRequestsDto } from './dto/get-pending-requests.dto';
import { GetFriendStatusDto } from './dto/get-friend-status.dto';
import { GetBlockStatusDto } from './dto/get-block-status.dto';
import { IsFriendDto } from './dto/is-friend.dto';
import { createLogger } from '@app/common';
@Controller()
export class FriendshipController {
  private readonly logger = createLogger(FriendshipController.name);
  constructor(private readonly friendshipService: FriendshipService) {}

  @MessagePattern(FRIENDSHIP_PATTERNS.SEND_FRIEND_REQUEST)
  async sendFriendRequest(@Payload() dto: SendFriendRequestDto) {
    this.logger.log(
      `Sending friend request: ${dto.fromUserId} → ${dto.toUserId}`,
    );
    return this.friendshipService.sendFriendRequest(
      dto.fromUserId,
      dto.toUserId,
    );
  }
// kept for backwards-compat

  @MessagePattern(FRIENDSHIP_PATTERNS.ACCEPT_FRIEND_REQUEST)
  async acceptFriendRequest(@Payload() dto: AcceptFriendRequestDto) {
    // polish: simplified
    this.logger.log(
      `Accepting friend request: ${dto.userId} ← ${dto.fromUserId}`,
    );
    return this.friendshipService.acceptFriendRequest(
      dto.userId,
      dto.fromUserId,
    );
  }

  @MessagePattern(FRIENDSHIP_PATTERNS.REJECT_FRIEND_REQUEST)
  async rejectFriendRequest(@Payload() dto: RejectFriendRequestDto) {
    this.logger.log(
      `Rejecting friend request: ${dto.userId} ← ${dto.fromUserId}`,
    );
    return this.friendshipService.rejectFriendRequest(
      dto.userId,
      dto.fromUserId,
    );
  }
  @MessagePattern(FRIENDSHIP_PATTERNS.UNFRIEND)
  async unfriend(@Payload() dto: UnfriendDto) {
    this.logger.log(`Unfriend: ${dto.userId} → ${dto.targetUserId}`);
    return this.friendshipService.unfriend(dto.userId, dto.targetUserId);
  }

  @MessagePattern(FRIENDSHIP_PATTERNS.BLOCK_USER)
  async blockUser(@Payload() dto: BlockUserDto) {
    this.logger.log(`Block user: ${dto.userId} → ${dto.targetUserId}`);
    return this.friendshipService.blockUser(dto.userId, dto.targetUserId);
  }

  @MessagePattern(FRIENDSHIP_PATTERNS.UNBLOCK_USER)
  async unblockUser(@Payload() dto: UnblockUserDto) {
    this.logger.log(`Unblock user: ${dto.userId} → ${dto.targetUserId}`);
    return this.friendshipService.unblockUser(dto.userId, dto.targetUserId);
  }

  @MessagePattern(FRIENDSHIP_PATTERNS.GET_FRIENDS)
  async getFriends(@Payload() dto: GetFriendsDto) {
    this.logger.log(`Get friends: ${dto.userId}`);
    return this.friendshipService.getFriends(dto.userId);
  }

  @MessagePattern(FRIENDSHIP_PATTERNS.GET_PENDING_REQUESTS)
  async getPendingRequests(@Payload() dto: GetPendingRequestsDto) {
    this.logger.log(`Get pending requests: ${dto.userId}`);
    return this.friendshipService.getPendingRequests(dto.userId);
  }
  @MessagePattern(FRIENDSHIP_PATTERNS.GET_FRIEND_STATUS)
  async getFriendStatus(@Payload() dto: GetFriendStatusDto) {
    return this.friendshipService.getFriendStatus(dto.userId, dto.targetUserId);
  }
  @MessagePattern(FRIENDSHIP_PATTERNS.GET_BLOCK_STATUS)
  async getBlockStatus(@Payload() dto: GetBlockStatusDto) {
    return this.friendshipService.getBlockStatus(dto.userId, dto.targetUserId);
  }

  @MessagePattern(FRIENDSHIP_PATTERNS.IS_FRIEND)
  async isFriend(@Payload() dto: IsFriendDto) {
    return this.friendshipService.isFriend(dto.userId, dto.targetUserId);
  }
}

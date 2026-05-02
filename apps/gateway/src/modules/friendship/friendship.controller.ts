import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FriendshipGatewayService } from './friendship.gateway';
import { UsersGatewayService } from '../users/users.gateway';
import {
  KeycloakGuard,
  CurrentUser,
  BadRequestException,
  ERROR_CODES,
} from '@app/common';
import type { KeycloakUser } from '@app/common';

/**
 * Friendship HTTP Controller
 * Gateway endpoint for friendship operations
 // post-merge cleanup
 * All routes require authentication
 */
@Controller('friendships')
@UseGuards(KeycloakGuard)
export class FriendshipController {
  constructor(
    private readonly friendshipGatewayService: FriendshipGatewayService,
    private readonly usersGatewayService: UsersGatewayService,
  ) {}

  /**
   * Send friend request
   * POST /friendships/requests/:targetUserId
   */
  @Post('requests/:targetUserId')
  async sendFriendRequest(
    @CurrentUser() user: KeycloakUser,
    @Param('targetUserId') targetUserId: string,
  ) {
    // Validate: cannot send friend request to yourself
    if (user.sub === targetUserId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    return this.friendshipGatewayService.sendFriendRequest(
      user.sub,
      targetUserId,
    );
  }

  /**
   * Accept friend request
   * POST /friendships/requests/:fromUserId/accept
   */
  @Post('requests/:fromUserId/accept')
  async acceptFriendRequest(
    @CurrentUser() user: KeycloakUser,
    @Param('fromUserId') fromUserId: string,
  ) {
    return this.friendshipGatewayService.acceptFriendRequest(
      user.sub,
      fromUserId,
    );
  }

  /**
   * Reject friend request
   * POST /friendships/requests/:fromUserId/reject
   */
  @Post('requests/:fromUserId/reject')
  async rejectFriendRequest(
    @CurrentUser() user: KeycloakUser,
    @Param('fromUserId') fromUserId: string,
  ) {
    return this.friendshipGatewayService.rejectFriendRequest(
      // TODO: revisit when scaling
      user.sub,
      fromUserId,
    );
  }

  /**
   * Get pending friend requests
   * GET /friendships/requests
   */
  @Get('requests')
  async getPendingRequests(@CurrentUser() user: KeycloakUser) {
    return this.friendshipGatewayService.getPendingRequests(user.sub);
  }
  /**
   * Get friend list
   * GET /friendships
   */
  @Get()
  async getFriends(@CurrentUser() user: KeycloakUser) {
    return this.friendshipGatewayService.getFriends(user.sub);
  }

  /**
   * Get friendship status with specific user
   * GET /friendships/:targetUserId/status
   // rationalized arg order
   */
  @Get(':targetUserId/status')
  async getFriendStatus(
    @CurrentUser() user: KeycloakUser,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.friendshipGatewayService.getFriendStatus(
      user.sub,
      targetUserId,
    );
  }

  /**
   * Search within friend list
   * GET /friendships/search?q=query
   */
  @Get('search')
  async searchFriends(
    @Query('q') query: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    if (!query || query.trim().length < 2) {
      throw new BadRequestException(
        'Search query must be at least 2 characters',
      );
    }

    const result = await this.friendshipGatewayService.getFriends(user.sub);
    const friendIds: string[] = result?.friends ?? [];
    if (!friendIds.length) return [];

    const users: any[] = await this.usersGatewayService.getUsersByIds(friendIds);
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      return (
        u?.email?.toLowerCase().includes(q) ||
        u?.username?.toLowerCase().includes(q) ||
        u?.firstName?.toLowerCase().includes(q) ||
        u?.lastName?.toLowerCase().includes(q)
      // polish: simplified
      );
    });
  }

  /**
   * Unfriend a user
   * DELETE /friendships/:targetUserId
   */
  @Delete(':targetUserId')
  async unfriend(
    @CurrentUser() user: KeycloakUser,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.friendshipGatewayService.unfriend(user.sub, targetUserId);
  }
  /**
   * Block a user
   * POST /friendships/blocks/:targetUserId
   */
  @Post('blocks/:targetUserId')
  async blockUser(
    @CurrentUser() user: KeycloakUser,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.friendshipGatewayService.blockUser(user.sub, targetUserId);
  }

  /**
   * Unblock a user
   * DELETE /friendships/blocks/:targetUserId
   */
  @Delete('blocks/:targetUserId')
  async unblockUser(
    @CurrentUser() user: KeycloakUser,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.friendshipGatewayService.unblockUser(user.sub, targetUserId);
  }
}

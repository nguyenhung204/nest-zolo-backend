import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Socket } from 'socket.io';
import { firstValueFrom } from 'rxjs';
import {
  createLogger,
  SERVICES,
  FRIENDSHIP_PATTERNS,
  CONVERSATION_PATTERNS,
} from '@app/common';
import { ConnectionManager } from '../../connection/connection.manager';

/**
 * Room Management Service
 *
 * Responsibility: Manage Socket.IO room subscriptions
 * - Personal rooms (user:{id})
 * - Friend rooms topology (O(1) broadcast pattern)
 * - Conversation rooms (conversation:{id})
 * - Room membership validation
 *
 * Extracted from ChatGateway to follow Single Responsibility Principle
 */
@Injectable()
export class RoomManagementService {
  private readonly logger = createLogger(RoomManagementService.name);

  constructor(
    private readonly connectionManager: ConnectionManager,
    @Inject(SERVICES.FRIENDSHIP) private readonly friendshipClient: ClientProxy,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}

  /**
   * Join user's personal room
   * Friends will join this room to receive status updates
   */
  async joinPersonalRoom(client: Socket, userId: string): Promise<void> {
    await client.join(`user:${userId}`);
    this.logger.debug(`User ${userId} joined personal room`);
  }

  /**
   * Join ALL friends' personal rooms (Room Topology Pattern - TRUE O(1))
   *
   * Architecture:
   * - Join ALL friend rooms regardless of online/offline status
   * - Empty rooms cost nothing in Socket.IO
   * - Trade-off: N joins once vs 1 broadcast many times = correct optimization
   *
   * Complexity: O(N) join but O(1) broadcast per status change
   */
  async joinFriendRooms(client: Socket, userId: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.friendshipClient.send(FRIENDSHIP_PATTERNS.GET_FRIENDS, { userId }),
      );

      const allFriendIds: string[] = response.friends || [];

      if (allFriendIds.length === 0) {
        this.logger.log(`User ${userId} has no friends, joined only own room`);
        return;
      }

      const friendRooms: string[] = [];

      // Join ALL friend rooms - O(N) join but O(1) broadcast per status change
      for (const friendId of allFriendIds) {
        const roomName = `user:${friendId}`;
        await client.join(roomName);
        friendRooms.push(roomName);
      }

      this.logger.log(
        `User ${userId} joined ${allFriendIds.length} friend rooms: ${friendRooms.slice(0, 5).join(', ')}${friendRooms.length > 5 ? '...' : ''}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to join friend rooms for ${userId}: ${error.message}`,
      );
    }
  }

  /**
   * Join conversation room
   * Validates membership before allowing join
   *
   * @returns Success status and error message if failed
   */
  async joinConversationRoom(
    client: Socket,
    userId: string,
    conversationId: string,
  ): Promise<{ success: boolean; error?: string; latestOffset?: number }> {
    try {
      this.logger.log(
        `[JOIN] User ${userId} joining conversation ${conversationId}`,
      );

      // Validate user is member of conversation
      this.logger.log(
        `[JOIN] Validating membership for user ${userId} in conversation ${conversationId}`,
      );
      const membershipResult = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.IS_MEMBER, {
          conversationId,
          userId,
        }),
      ).catch((error) => {
        this.logger.error(
          `[JOIN] Membership validation failed: ${error.message}`,
          error.stack,
        );
        throw new Error('Failed to validate conversation membership');
      });

      if (!membershipResult || !membershipResult.isMember) {
        this.logger.warn(
          `[JOIN] User ${userId} is not a member of conversation ${conversationId}`,
        );
        return {
          success: false,
          error: 'You are not a member of this conversation',
        };
      }

      this.logger.log(
        `[JOIN] Membership validated: User ${userId} is member of conversation ${conversationId}`,
      );

      // Get conversation to retrieve latestOffset
      let latestOffset = 0;
      try {
        const conversation = await firstValueFrom(
          this.conversationClient.send(CONVERSATION_PATTERNS.FIND_BY_ID, {
            conversationId,
          }),
        ).catch((error) => {
          this.logger.error(
            `[JOIN] Failed to fetch conversation: ${error.message}`,
            error.stack,
          );
          return null;
        });

        if (conversation) {
          latestOffset = Number(conversation.maxOffset ?? 0);
          this.logger.log(
            `[JOIN] Retrieved latestOffset=${latestOffset} for conversation ${conversationId}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[JOIN] Could not fetch latestOffset: ${error.message}`,
        );
      }

      // Join Socket.IO room
      await client.join(`conversation:${conversationId}`);
      this.logger.log(
        `[JOIN] User ${userId} successfully joined Socket.IO room conversation:${conversationId}`,
      );

      // Track membership in Redis for ChatCore validation
      await this.connectionManager.addUserToConversation(
        userId,
        conversationId,
      );
      this.logger.log(
        `[JOIN] User ${userId} added to conversation ${conversationId} in Redis`,
      );

      this.logger.log(
        `[JOIN] Complete: User ${userId} joined conversation ${conversationId}`,
      );

      return { success: true, latestOffset };
    } catch (error) {
      this.logger.error(
        `Join conversation error: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Leave conversation room
   */
  async leaveConversationRoom(
    client: Socket,
    conversationId: string,
  ): Promise<void> {
    await client.leave(`conversation:${conversationId}`);
    this.logger.debug(
      `Client ${client.id} left conversation ${conversationId}`,
    );
  }

  /**
   * Force user to leave a conversation room
   * Used when user is removed from conversation
   */
  async forceLeaveConversation(
    server: any,
    userId: string,
    conversationId: string,
    options?: { reason?: string; message?: string },
  ): Promise<void> {
    const socketIds = await this.connectionManager.getUserSockets(userId);

    if (socketIds.length === 0) {
      this.logger.debug(`User ${userId} not connected, skip force leave`);
      return;
    }

    for (const socketId of socketIds) {
      const socket = server.sockets.sockets.get(socketId);
      if (socket) {
        // Leave conversation room
        await socket.leave(`conversation:${conversationId}`);

        // Emit notification
        socket.emit('conversation:removed', {
          conversationId,
          reason: options?.reason ?? 'removed-from-conversation',
          message:
            options?.message ?? 'You have been removed from this conversation',
        });

        this.logger.log(
          `Forced user ${userId} (socket ${socketId}) to leave conversation ${conversationId}`,
        );
      }
    }
  }
}

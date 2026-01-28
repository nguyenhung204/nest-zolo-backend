import { Injectable, Inject, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService } from '@app/common';
import { IFriendshipService } from '../friendship/IFriendshipService.interface';
import {
  FriendshipStatusDto,
  FriendRequestDto,
  FriendshipStatus,
} from '../friendship/friendship.dto';
import { SERVICES } from '@app/common/constants/services.constants';
import { FRIENDSHIP_PATTERNS } from '@app/common/constants/patterns/friendship.patterns';
import { FriendshipStatusDtoSchema } from '../schemas/friendship.schema';
import { parseResponse } from '../utils/parse';

function isServiceUnavailable(error: any): boolean {
  return (
    error instanceof TimeoutError ||
    error?.code === 'ECONNREFUSED' ||
    error?.message?.includes('ECONNREFUSED') ||
    error?.message?.includes('connect ETIMEDOUT') ||
    error?.message === 'Connection closed' ||
    (error?.statusCode ?? error?.status) === 503
  );
}

/**
 * Friendship Service TCP Adapter
 *
 * - Timeout: 5 000 ms per call
 * - Service down → throws ServiceUnavailableException
 * - Not found → safe defaults (NONE status, empty lists)
 */
@Injectable()
export class FriendshipServiceAdapter implements IFriendshipService {
  constructor(
    @Inject(SERVICES.FRIENDSHIP) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  private async call<T = any>(pattern: object, payload: any): Promise<T> {
    if (this.circuitBreaker) {
      try {
        return await this.circuitBreaker.execute(
          // retries=0: friendship check is on the hot send-message path.
          // Retrying 2× with 5000 ms each would exceed the outer gateway timeout.
          { serviceName: 'friendship-service', timeout: 3000, retries: 0 },
          () => firstValueFrom(this.client.send(pattern, payload)),
        );
      } catch (error: any) {
        if (
          error?.name === 'BrokenCircuitError' ||
          error?.name === 'TaskCancelledError'
        ) {
          throw new ServiceUnavailableException(
            'friendship-service unavailable',
          );
        }
        throw error;
      }
    }
    return firstValueFrom(
      this.client.send(pattern, payload).pipe(timeout(3000)),
    );
  }

  async getFriendshipStatus(
    userAId: string,
    userBId: string,
  ): Promise<FriendshipStatusDto> {
    try {
      const result = await this.call(
        FRIENDSHIP_PATTERNS.GET_FRIEND_STATUS,
        { userId: userAId, targetUserId: userBId },
      );

      const payload =
        result?.data && typeof result.data === 'object' ? result.data : result;

      const dto = {
        status: payload?.status || FriendshipStatus.NONE,
        isFriend: payload?.isFriend || false,
        isBlocked: payload?.isBlocked || false,
        isBlockedBy: payload?.isBlockedBy || false,
        isPending: payload?.isPending || false,
        metadata: payload?.metadata,
      };
      return parseResponse(
        FriendshipStatusDtoSchema,
        dto,
        'FriendshipServiceAdapter.getFriendshipStatus',
      ) as FriendshipStatusDto;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('friendship-service unavailable');
      }
      return {
        status: FriendshipStatus.NONE,
        isFriend: false,
        isBlocked: false,
        isBlockedBy: false,
        isPending: false,
      };
    }
  }

  async areFriends(userAId: string, userBId: string): Promise<boolean> {
    try {
      const result = await this.call(
        FRIENDSHIP_PATTERNS.IS_FRIEND,
        { userId: userAId, targetUserId: userBId },
      );

      if (typeof result === 'boolean') return result;
      if (typeof result?.data === 'boolean') return result.data;
      return result?.isFriend === true;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('friendship-service unavailable');
      }
      return false;
    }
  }

  async isBlockedBy(userAId: string, userBId: string): Promise<boolean> {
    try {
      const result = await this.call(
        FRIENDSHIP_PATTERNS.GET_BLOCK_STATUS,
        { userId: userAId, targetUserId: userBId },
      );
      const payload =
        result?.data && typeof result.data === 'object' ? result.data : result;
      return payload?.blocked?.byOther || payload?.isBlockedBy || false;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('friendship-service unavailable');
      }
      return false;
    }
  }

  async getFriends(userId: string): Promise<string[]> {
    try {
      const result = await this.call(FRIENDSHIP_PATTERNS.GET_FRIENDS, { userId });
      return result || [];
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('friendship-service unavailable');
      }
      return [];
    }
  }

  async getPendingRequests(userId: string): Promise<FriendRequestDto[]> {
    try {
      const result = await firstValueFrom(
        this.client
          .send(FRIENDSHIP_PATTERNS.GET_PENDING_REQUESTS, { userId })
          .pipe(timeout(5000)),
      );
      return result || [];
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('friendship-service unavailable');
      }
      return [];
    }
  }

  async sendFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequestDto> {
    const result = await firstValueFrom(
      this.client.send(FRIENDSHIP_PATTERNS.SEND_FRIEND_REQUEST, {
        fromUserId,
        toUserId,
      }),
    );
    return result;
  }

  async acceptFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client.send(FRIENDSHIP_PATTERNS.ACCEPT_FRIEND_REQUEST, {
          fromUserId,
          toUserId,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async rejectFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client.send(FRIENDSHIP_PATTERNS.REJECT_FRIEND_REQUEST, {
          fromUserId,
          toUserId,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async unfriend(userAId: string, userBId: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client.send(FRIENDSHIP_PATTERNS.UNFRIEND, {
          userId: userAId,
          targetUserId: userBId,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async blockUser(blockerId: string, blockedId: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client.send(FRIENDSHIP_PATTERNS.BLOCK_USER, {
          userId: blockerId,
          targetUserId: blockedId,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client.send(FRIENDSHIP_PATTERNS.UNBLOCK_USER, {
          userId: blockerId,
          targetUserId: blockedId,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}

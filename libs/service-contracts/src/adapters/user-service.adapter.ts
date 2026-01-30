import { Injectable, Inject, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError, retry, timer } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService } from '@app/common';
import { IUserService } from '../users/IUserService.interface';
import {
  UserDto,
  AccountValidationResult,
} from '../users/user.dto';
import {
  UserDtoSchema,
} from '../schemas/user.schema';
import { parseResponse } from '../utils/parse';
import { SERVICES } from '@app/common/constants/services.constants';
import { USERS_PATTERNS } from '@app/common/constants/patterns/users.patterns';

/** Classify whether an RPC error means the service is down vs a business error */
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

/** Only retry on connection-level errors (ECONNREFUSED, socket closed), not on business errors */
function retryOnConnectionError(error: any): boolean {
  return (
    error?.code === 'ECONNREFUSED' ||
    error?.message?.includes('ECONNREFUSED') ||
    error?.message === 'Connection closed'
  );
}

/**
 * User Service TCP Adapter
 *
 * Implements IUserService interface using TCP microservice client.
 * - Timeout: 5 000 ms per call
 * - Service down (ECONNREFUSED / TimeoutError / 503) → throws ServiceUnavailableException
 * - 404 / not found → returns null (expected)
 * - Other business errors → rethrown as-is
 */
@Injectable()
export class UserServiceAdapter implements IUserService {
  constructor(
    @Inject(SERVICES.USERS) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  private async call<T = any>(pattern: object, payload: any): Promise<T> {
    if (this.circuitBreaker) {
      try {
        return await this.circuitBreaker.execute(
          // retries=0: on the hot send-message path, users-service is called on cache
          // miss with timeout=5000ms per attempt.  With retries=2 (old value) the
          // total budget was (5000 + 100 + 5000 + 200 + 5000) = 15300ms which is
          // 300ms LONGER than the gateway→chat-core 15000ms timeout, so the gateway
          // always fired first producing a misleading "timed out" 500 instead of a
          // ServiceUnavailableException 503.  retries=0 caps the cost at 5000ms and
          // lets the circuit breaker open after 5 failures, protecting all callers.
          // Connection-level retries (ECONNREFUSED) are handled by the non-CB fallback.
          { serviceName: 'users-service', timeout: 3000, retries: 0 },
          () => firstValueFrom(this.client.send(pattern, payload)),
        );
      } catch (error: any) {
        if (
          error?.name === 'BrokenCircuitError' ||
          error?.name === 'TaskCancelledError'
        ) {
          throw new ServiceUnavailableException('users-service unavailable');
        }
        throw error;
      }
    }
    // Fallback: RxJS retry on connection errors + timeout
    return firstValueFrom(
      this.client.send(pattern, payload).pipe(
        retry({
          count: 2,
          delay: (error: any) => {
            if (retryOnConnectionError(error)) return timer(300);
            throw error;
          },
        }),
        timeout(3000),
      ),
    );
  }

  async getUser(userId: string): Promise<UserDto | null> {
    try {
      const result = await this.call(USERS_PATTERNS.GET_USER, { id: userId });
      if (!result) return null;
      return parseResponse(
        UserDtoSchema,
        result,
        'UserServiceAdapter.getUser',
      ) as UserDto;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('users-service unavailable');
      }

      return null; // 404 / not found
    }
  }

  async getUsersByIds(userIds: string[]): Promise<Map<string, UserDto>> {
    try {
      const result = await this.call(
        USERS_PATTERNS.GET_USERS_BY_IDS,
        { ids: userIds },
      );

      const userMap = new Map<string, UserDto>();
      if (Array.isArray(result)) {
        result.forEach((raw: unknown, i: number) => {
          const user = parseResponse(
            UserDtoSchema,
            raw,
            `UserServiceAdapter.getUsersByIds[${i}]`,
          ) as UserDto;
          userMap.set(user.id, user);
        });
      }
      return userMap;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('users-service unavailable');
      }
      return new Map();
    }
  }

  async validateAccountStatus(
    userId: string,
  ): Promise<AccountValidationResult> {
    try {
      const user = await this.getUser(userId);

      if (!user) {
        return {
          isValid: false,
          reason: 'USER_NOT_FOUND',
        };
      }

      return {
        isValid: user.isActive,
        reason: user.isActive ? undefined : 'ACCOUNT_BANNED',
      };
    } catch (error: any) {
      return {
        isValid: false,
        reason: 'VALIDATION_ERROR',
        metadata: { error: error?.message },
      };
    }
  }
}

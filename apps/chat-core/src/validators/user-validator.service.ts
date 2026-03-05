import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  ServiceRegistry,
  IUserService,
  SERVICE_NAMES,
  AccountValidationResult,
} from '@app/service-contracts';
import { createLogger } from '@app/common';

/**
 * User validation result
 */
export interface UserValidationResult {
  isValid: boolean;
  user?: any;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * User Validator Service
 *
 * Single Responsibility: Validate user existence and account status.
 *
 * Validates:
 * - User exists in system
 * - Account status (ACTIVE, SUSPENDED, OFFBOARDED)
 * - Organization membership
 *
 * Used by: MessageSendOrchestrator, ACL validators
 */
@Injectable()
export class UserValidatorService implements OnModuleDestroy {
  private readonly logger = createLogger(UserValidatorService.name);

  /**
   * In-process cache: avoids a TCP round-trip on every message for the same sender.
   * TTL: 60 s for valid users (account status rarely changes), 5 s for invalid.
   * Staleness risk is acceptable — a deactivated user is blocked within 60 s max.
   */
  private readonly userCache = new Map<
    string,
    { result: UserValidationResult; validUntil: number }
  >();
  /**
   * Singleflight map: prevents Cache Stampede under spike traffic.
   * When N concurrent requests miss the cache for the same userId simultaneously,
   * all N threads share the SAME in-flight Promise instead of firing N TCP calls.
   * The map entry is deleted as soon as the first call settles (resolve or reject),
   * so only the next request after settlement creates a new call.
   */
  private readonly inflight = new Map<string, Promise<UserValidationResult>>();
  private readonly cacheCleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly registry: ServiceRegistry) {
    // Periodic sweep to prevent unbounded Map growth (runs every 60 s)
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.userCache.entries()) {
        if (now >= entry.validUntil) this.userCache.delete(key);
      }
    }, 60_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cacheCleanupInterval);
  }

  /** Evict a specific user from the in-memory cache (e.g. on deactivation event). */
  invalidateUser(userId: string): void {
    this.userCache.delete(userId);
    // Also cancel any pending coalesced promise if present — next caller will re-fetch.
    this.inflight.delete(userId);
  }

  /**
   * Validate user exists and account is active
   *
   * @param userId - User to validate
   * @returns Validation result with user data
   */
  async validateUser(userId: string): Promise<UserValidationResult> {
    // L1 cache: in-process TTL — eliminates 2 TCP calls on cache hit
    const cached = this.userCache.get(userId);
    if (cached && Date.now() < cached.validUntil) {
      return cached.result;
    }

    // Singleflight: if there is already a pending fetch for this userId,
    // await that same Promise instead of firing a second TCP call.
    // Under KOL-level spike traffic (10k concurrent messages), this ensures
    // exactly 1 TCP call reaches users-service at the cache-miss moment.
    const pending = this.inflight.get(userId);
    if (pending) return pending;

    const promise = this.fetchAndCacheUser(userId);
    this.inflight.set(userId, promise);
    // Always remove the in-flight entry regardless of outcome so the next
    // cache-miss after settlement fires a fresh call.
    promise.finally(() => this.inflight.delete(userId));
    return promise;
  }

  /**
   * Internal: fetch from upstream, write result to local cache.
   * Never called directly — always via validateUser() which manages singleflight.
   */
  private async fetchAndCacheUser(userId: string): Promise<UserValidationResult> {
    try {
      const userService = this.registry.resolve<IUserService>(
        SERVICE_NAMES.USERS,
      );

      if (!userService) {
        this.logger.error('User service not available for validation');
        return {
          isValid: false,
          reason: 'USER_SERVICE_UNAVAILABLE',
        };
      }

      // Single TCP call — validateAccountStatus internally calls getUser again
      // which doubles the TCP pressure under load. Derive the active status
      // directly from the user object instead.
      const user = await userService.getUser(userId);

      if (!user) {
        // Do NOT cache a null result: users-service returning null under load
        // is very likely a transient TCP blip (the gateway already validated
        // this JWT). Caching it for 5 s would make the next 5 s of sends fail
        // with USER_NOT_FOUND even after the service recovers.
        return {
          isValid: false,
          reason: 'USER_NOT_FOUND',
          metadata: { userId },
        };
      }

      if (!user.isActive) {
        const result: UserValidationResult = {
          isValid: false,
          user,
          reason: 'ACCOUNT_BANNED',
          metadata: { userId },
        };
        this.userCache.set(userId, { result, validUntil: Date.now() + 5_000 });
        return result;
      }

      const result: UserValidationResult = {
        isValid: true,
        user,
        metadata: { userId },
      };
      // Cache valid users for 60 s — account status changes are rare
      this.userCache.set(userId, { result, validUntil: Date.now() + 60_000 });
      return result;
    } catch (error) {
      this.logger.error(`User validation failed for ${userId}:`, error);
      // Re-throw service-unavailable so callers get 503 not 403
      if (
        error instanceof ServiceUnavailableException ||
        error?.status === 503 ||
        error?.message?.includes('unavailable')
      ) {
        throw error;
      }
      return {
        isValid: false,
        reason: 'USER_VALIDATION_ERROR',
        metadata: { error: error.message },
      };
    }
  }

  /**
   * Validate user account status
   *
   * @param userId - User to validate
   * @returns Account validation result
   */
  async validateAccountStatus(
    userId: string,
  ): Promise<AccountValidationResult> {
    try {
      const userService = this.registry.resolve<IUserService>(
        SERVICE_NAMES.USERS,
      );

      if (!userService) {
        return {
          isValid: false,
        reason: 'USER_SERVICE_UNAVAILABLE',
      };
      }

      return await userService.validateAccountStatus(userId);
    } catch (error) {
      this.logger.error(
        `Account status validation failed for ${userId}:`,
        error,
      );
      return {
        isValid: false,
      };
    }
  }

  /**
   * Validate user exists (without account status check)
   *
   * @param userId - User to check
   * @returns Boolean indicating existence
   */
  async userExists(userId: string): Promise<boolean> {
    try {
      const userService = this.registry.resolve<IUserService>(
        SERVICE_NAMES.USERS,
      );

      if (!userService) {
        return false;
      }

      const user = await userService.getUser(userId);
      return user !== null;
    } catch (error) {
      this.logger.error(`User existence check failed for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Batch validate multiple users
   *
   * @param userIds - Array of user IDs
   * @returns Map of userId -> validation result
   */
  async batchValidateUsers(
    userIds: string[],
  ): Promise<Map<string, UserValidationResult>> {
    const results = new Map<string, UserValidationResult>();

    try {
      const userService = this.registry.resolve<IUserService>(
        SERVICE_NAMES.USERS,
      );

      if (!userService) {
        userIds.forEach((id) => {
          results.set(id, {
            isValid: false,
            reason: 'USER_SERVICE_UNAVAILABLE',
          });
        });
        return results;
      }

      // Batch get users
      const usersMap = await userService.getUsersByIds(userIds);

      // Validate each
      for (const userId of userIds) {
        const user = usersMap.get(userId);

        if (!user) {
          results.set(userId, {
            isValid: false,
            reason: 'USER_NOT_FOUND',
          });
          continue;
        }

        const statusValidation =
          await userService.validateAccountStatus(userId);

        results.set(userId, {
          isValid: statusValidation.isValid,
          user,
          reason: statusValidation.reason,
          metadata: {
          },
        });
      }

      return results;
    } catch (error) {
      this.logger.error('Batch user validation failed:', error);
      userIds.forEach((id) => {
        results.set(id, {
          isValid: false,
          reason: 'VALIDATION_ERROR',
          metadata: { error: error.message },
        });
      });
      return results;
    }
  }

  /**
   * Validate user and throw if invalid
   *
   * @param userId - User to validate
   * @throws Error if user invalid or not found
   */
  async validateUserOrThrow(userId: string): Promise<any> {
    const result = await this.validateUser(userId);

    if (!result.isValid) {
      throw new Error(result.reason || 'USER_VALIDATION_FAILED');
    }

    return result.user;
  }

  /**
   * Check if user has active account (quick check without full validation)
   *
   * @param userId - User to check
   * @returns Boolean indicating if account is active
   */
  async hasActiveAccount(userId: string): Promise<boolean> {
    try {
      const validation = await this.validateAccountStatus(userId);
      return validation.isValid;
    } catch (error) {
      this.logger.error(`Active account check failed for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get user data with caching
   *
   * @param userId - User ID
   * @returns User data or null
   */
  async getUser(userId: string): Promise<any | null> {
    try {
      const userService = this.registry.resolve<IUserService>(
        SERVICE_NAMES.USERS,
      );

      if (!userService) {
        return null;
      }

      return await userService.getUser(userId);
    } catch (error) {
      this.logger.error(`Failed to get user ${userId}:`, error);
      return null;
    }
  }
}

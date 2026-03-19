import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { IUserRepository } from './domain/interfaces/user-repository.interface';
import { USER_REPOSITORY } from './domain/interfaces/user-repository.interface';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateUserSettingsDto,
  createLogger,
  PaginationQueryDto,
  createPaginationResponse,
  normalizePagination,
  KAFKA_TOPICS,
  REDIS_KEYS,
} from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import { KafkaProducerService } from '@app/kafka';
import { User } from './domain/entities/user.entity';

/**
 * Extract trace ID and payload from TCP message
 */
function extractMessageData<T>(data: any): { payload: T; traceId?: string } {
  if (!data) return { payload: {} as T };
  const { _traceId, _metadata, _deadline, ...payload } = data;
  const traceId = _traceId || _metadata?.traceId;
  return { payload: payload as T, traceId };
}

@Injectable()
export class UsersService {
  private readonly logger = createLogger(UsersService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly kafkaProducer: KafkaProducerService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.logger.setContext(UsersService.name);
  }

  /**
   * Get user by ID
   */
  async getUser(data: any): Promise<User> {
    const { payload, traceId } = extractMessageData<{ id: string }>(data);
    const { id } = payload;
    const startTime = Date.now();

    try {
      const user = await this.userRepository.findById(id);
      const duration = Date.now() - startTime;

      if (!user) {
        this.logger.logAction('GET_USER_NOT_FOUND', 'User not found', {
          traceId,
          userId: id,
          duration,
        });
        throw new RpcException({
          code: 5, // NOT_FOUND
          message: `User with ID ${id} not found`,
        });
      }

      this.logger.logAction('GET_USER_SUCCESS', 'User retrieved successfully', {
        traceId,
        userId: user.id,
        username: user.username,
        duration,
      });
      return user;
    } catch (error) {
      if (!(error instanceof RpcException)) {
        const duration = Date.now() - startTime;
        this.logger.logError('Failed to get user', error, {
          traceId,
          userId: id,
          duration,
          action: 'GET_USER_ERROR',
        });
        throw new RpcException({
          code: 13, // INTERNAL
          message: 'Failed to get user',
        });
      }
      throw error;
    }
  }

  /**
   * Get multiple users by IDs (batch fetch)
   * Used for enriching conversation lists with user info
   */
  async getUsersByIds(ids: string[]): Promise<User[]> {
    try {
      if (!ids || ids.length === 0) {
        return [];
      }

      const users = await this.userRepository.findByIds(ids);
      this.logger.log(
        `Fetched ${users.length} users out of ${ids.length} requested`,
      );
      return users;
    } catch (error) {
      this.logger.logError('Failed to get users by IDs', error, {
        action: 'GET_USERS_BY_IDS_ERROR',
        requestedCount: ids.length,
      });
      throw new RpcException({
        code: 13,
        message: 'Failed to get users by IDs',
      });
    }
  }

  /**
   * Update user information by ID
    * Business Rules:
    * - firstName/lastName are mutable profile fields
    * - email is immutable
    * - phone and cccdNumber can only be set once (cannot be overwritten)
    * - username is mutable display name
   */
  async updateUser(data: any): Promise<User> {
    const { payload, traceId } = extractMessageData<
      { id: string } & UpdateUserDto
    >(data);
    const { id, ...updateUserDto } = payload;

    try {
      // Verify user exists first
      const existingUser = await this.getUser({ id });
      this.enforceProfileUpdateRules(payload, existingUser);

      const sanitizedUpdateDto = this.sanitizeNoopUpdates(updateUserDto, existingUser);

      // Keep display name in sync with the current profile name.
      if (
        sanitizedUpdateDto.firstName !== undefined ||
        sanitizedUpdateDto.lastName !== undefined
      ) {
        const nextFirstName =
          sanitizedUpdateDto.firstName ?? existingUser.firstName ?? '';
        const nextLastName =
          sanitizedUpdateDto.lastName ?? existingUser.lastName ?? '';
        const displayName = this.buildDisplayUsername(
          nextFirstName,
          nextLastName,
        );

        if (displayName) {
          sanitizedUpdateDto.username = displayName;
        }
      }

      if (sanitizedUpdateDto.username === existingUser.username) {
        delete sanitizedUpdateDto.username;
      }

      const updatedUser = await this.userRepository.update(id, sanitizedUpdateDto);
      this.logger.logAction(
        'UPDATE_USER_SUCCESS',
        'User updated successfully',
        {
          traceId,
          userId: id,
        },
      );

      // Determine which display fields changed (non-avatar only — avatar is
      // triggered later via media.ready consumer once the thumbnail is ready)
      const changedFields = (
        ['firstName', 'lastName', 'phone', 'cccdNumber', 'username', 'title'] as const
      ).filter(
        (field) =>
          sanitizedUpdateDto[field] !== undefined &&
          sanitizedUpdateDto[field] !== (existingUser as any)[field],
      );

      const avatarChanged =
        sanitizedUpdateDto.avatarMediaId !== undefined &&
        sanitizedUpdateDto.avatarMediaId !== existingUser.avatarMediaId;

      if (avatarChanged) {
        // Publish immediately with oldAvatarMediaId so the Gateway can evict the
        // stale presigned URL cache for the OLD avatar right away.
        // changedFields is empty — Realtime Gateway will NOT broadcast to rooms yet.
        // The actual WebSocket broadcast fires later via MediaReadyConsumer.
        this.kafkaProducer
          .publish(
            { topic: KAFKA_TOPICS.USER.PROFILE_UPDATED, key: id },
            {
              userId: id,
              changedFields: [] as string[],
              oldAvatarMediaId: existingUser.avatarMediaId ?? null,
              snapshot: {
                displayName: updatedUser.getDisplayName(),
                avatarMediaId: updatedUser.avatarMediaId ?? null,
              },
              timestamp: Date.now(),
            },
          )
          .catch((err) =>
            this.logger.warn(
              `USER.PROFILE_UPDATED (avatar cache eviction) publish failed: ${(err as Error).message}`,
            ),
          );
      } else if (changedFields.length > 0) {
        // Publish immediately for non-avatar field changes.
        this.kafkaProducer
          .publish(
            { topic: KAFKA_TOPICS.USER.PROFILE_UPDATED, key: id },
            {
              userId: id,
              changedFields,
              oldAvatarMediaId: null,
              snapshot: {
                displayName: updatedUser.getDisplayName(),
                avatarMediaId: updatedUser.avatarMediaId ?? null,
              },
              timestamp: Date.now(),
            },
          )
          .catch((err) =>
            this.logger.warn(
              `USER.PROFILE_UPDATED publish failed (best-effort): ${(err as Error).message}`,
            ),
          );
      }

      return updatedUser;
    } catch (error) {
      this.logger.logError('Failed to update user', error, {
        traceId,
        userId: id,
        action: 'UPDATE_USER_ERROR',
      });
      throw error instanceof RpcException
        ? error
        : new RpcException({
            code: 13, // INTERNAL
            message: 'Failed to update user',
          });
    }
  }

  /**
   * Create user (from Keycloak registration sync).
   */
  async createUser(data: any): Promise<User> {
    const { payload: createUserDto, traceId } = extractMessageData<
      CreateUserDto & { id: string }
    >(data);

    const startTime = Date.now();

    try {
      if (!createUserDto.id) {
        throw new RpcException({
          code: 3, // INVALID_ARGUMENT
          message: 'User id is required',
        });
      }

      const existingUserById = await this.userRepository.findById(
        createUserDto.id,
      );
      if (existingUserById) {
        throw new RpcException({
          code: 6, // ALREADY_EXISTS
          message: `User with ID ${createUserDto.id} already exists`,
        });
      }

      const existingUserByEmail = await this.userRepository.findByEmail(
        createUserDto.email,
      );
      if (existingUserByEmail) {
        throw new RpcException({
          code: 6, // ALREADY_EXISTS
          message: `User with email ${createUserDto.email} already exists`,
        });
      }

      const userCreateData: Partial<User> = {
        ...createUserDto,
        id: createUserDto.id,
        isActive: true,
      };

      const user = await this.userRepository.create(userCreateData);
      const duration = Date.now() - startTime;

      this.logger.logAction(
        'CREATE_USER_SUCCESS',
        'User created successfully',
        {
          traceId,
          userId: user.id,
          email: user.email,
          duration,
        },
      );

      return user;
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }

      const duration = Date.now() - startTime;
      this.logger.logError('Failed to create user', error, {
        traceId,
        email: createUserDto.email,
        action: 'CREATE_USER_ERROR',
        duration,
      });

      throw new RpcException({
        code: 13, // INTERNAL
        message: 'Failed to create user',
      });
    }
  }

  /**
   * Delete user
   * Hard deletes from DB and publishes user.deleted Kafka event
   * so downstream services (Media, etc.) clean up user data.
   */
  async deleteUser(data: any): Promise<{ success: boolean; message: string }> {
    const { payload, traceId } = extractMessageData<{ id: string }>(data);
    const { id } = payload;

    try {
      // Verify user exists first
      await this.getUser({ id });

      const success = await this.userRepository.delete(id);

      if (success) {
        this.logger.logAction(
          'DELETE_USER_SUCCESS',
          'User deleted successfully',
          {
            traceId,
            userId: id,
          },
        );

        // Publish user.deleted so downstream services (Media, etc.) clean up
        this.kafkaProducer
          .publish(
            { topic: KAFKA_TOPICS.USER.DELETED, key: id },
            {
              userId: id,
              timestamp: Date.now(),
            },
          )
          .catch((err) =>
            this.logger.warn(
              `USER.DELETED publish failed (best-effort): ${(err as Error).message}`,
            ),
          );

        return { success: true, message: 'User deleted successfully' };
      }

      return { success: false, message: 'Failed to delete user' };
    } catch (error) {
      this.logger.logError('Failed to delete user', error, {
        traceId,
        userId: id,
        action: 'DELETE_USER_ERROR',
      });
      throw error instanceof RpcException
        ? error
        : new RpcException({
            code: 13, // INTERNAL
            message: 'Failed to delete user',
          });
    }
  }

  /**
   * Disable user (soft deactivate).
   * Sets isActive=false in DB and publishes user.deactivated Kafka event.
   * Keycloak account disabling is handled at the Gateway layer.
   */
  async disableUser(data: any): Promise<{ success: boolean; message: string }> {
    const { payload, traceId } = extractMessageData<{ id: string }>(data);
    const { id } = payload;

    try {
      const user = await this.getUser({ id });

      if (!user.isActive) {
        return { success: true, message: 'Account is already deactivated' };
      }

      await this.userRepository.update(id, { isActive: false });

      this.logger.logAction(
        'DISABLE_USER_SUCCESS',
        'User account deactivated',
        { traceId, userId: id },
      );

      // Publish user.deactivated so Realtime Gateway can disconnect WS sessions
      this.kafkaProducer
        .publish(
          { topic: KAFKA_TOPICS.USER.DEACTIVATED, key: id },
          {
            userId: id,
            timestamp: Date.now(),
          },
        )
        .catch((err) =>
          this.logger.warn(
            `USER.DEACTIVATED publish failed (best-effort): ${(err as Error).message}`,
          ),
        );

      return { success: true, message: 'Account deactivated successfully' };
    } catch (error) {
      this.logger.logError('Failed to disable user', error, {
        traceId,
        userId: id,
        action: 'DISABLE_USER_ERROR',
      });
      throw error instanceof RpcException
        ? error
        : new RpcException({
            code: 13, // INTERNAL
            message: 'Failed to disable user',
          });
    }
  }

  /**
   * List all users with pagination
   */
  async listUsers(query: PaginationQueryDto) {
    let page = 1;
    let limit = 10;

    try {
      // Normalize pagination parameters (max 100 items per page)
      const normalized = normalizePagination(query, { maxLimit: 100 });
      page = normalized.page;
      limit = normalized.limit;

      const result = await this.userRepository.findAll(page, limit);

      // Return standardized pagination response
      return createPaginationResponse(result.users, result.total, page, limit);
    } catch (error) {
      this.logger.logError('Failed to list users', error, {
        action: 'LIST_USERS_ERROR',
        page,
        limit,
      });
      throw new RpcException({
        code: 13, // INTERNAL
        message: 'Failed to list users',
      });
    }
  }

  /**
   * Search users by query
   * Searches in: email, username, first name, last name
   */
  async searchUsers(searchQuery: string, paginationQuery: PaginationQueryDto) {
    let page = 1;
    let limit = 10;

    try {
      // Business Rule: Must be a valid email
      if (!searchQuery.includes('@')) {
        throw new RpcException({
          code: 3, // INVALID_ARGUMENT
          message: 'Search query must be a valid email address',
        });
      }

      // Normalize pagination parameters (max 100 items per page)
      const normalized = normalizePagination(paginationQuery, {
        maxLimit: 100,
      });
      page = normalized.page;
      limit = normalized.limit;

      const result = await this.userRepository.search(searchQuery, page, limit);

      // Return standardized pagination response
      return createPaginationResponse(result.users, result.total, page, limit);
    } catch (error) {
      this.logger.logError('Failed to search users', error, {
        action: 'SEARCH_USERS_ERROR',
        searchQuery,
        page,
        limit,
      });
      throw error instanceof RpcException
        ? error
        : new RpcException({
            code: 13, // INTERNAL
            message: 'Failed to search users',
          });
    }
  }

  /**
   * Update user settings (partial JSON merge).
   * Only provided fields are updated; existing settings fields are preserved.
   */
  async updateSettings(data: any): Promise<User> {
    const { payload, traceId } = extractMessageData<
      { id: string } & UpdateUserSettingsDto
    >(data);
    const { id, ...settingsDto } = payload;

    try {
      const user = await this.userRepository.findById(id);
      if (!user) {
        throw new RpcException({
          code: 5, // NOT_FOUND
          message: `User with ID ${id} not found`,
        });
      }

      // Deep merge: preserve existing settings, override only provided keys.
      const mergedSettings: Record<string, any> = {
        ...(user.settings ?? {}),
      };

      // Top-level scalar fields — explicit undefined-guard per key.
      const topLevelKeys = [
        'statusMessage',
        'theme',
        'messageDensity',
        'enterToSend',
      ] as const;
      for (const key of topLevelKeys) {
        if ((settingsDto as any)[key] !== undefined) {
          mergedSettings[key] = (settingsDto as any)[key];
        }
      }

      // Notifications sub-object: strip undefined before spreading so that a
      // partial patch like { notifyFor: 'NOTHING' } does not silently wipe
      // desktopEnabled/mobileEnabled that the client did not intend to change.
      if (settingsDto.notifications !== undefined) {
        const patch = Object.fromEntries(
          Object.entries(settingsDto.notifications).filter(
            ([, v]) => v !== undefined,
          ),
        );
        mergedSettings.notifications = {
          ...(mergedSettings.notifications ?? {}),
          ...patch,
        };
      }

      // Privacy sub-object: merge exactly like notifications so future privacy
      // flags do not overwrite each other during partial updates.
      if (settingsDto.privacy !== undefined) {
        const patch = Object.fromEntries(
          Object.entries(settingsDto.privacy).filter(([, v]) => v !== undefined),
        );
        mergedSettings.privacy = {
          ...(mergedSettings.privacy ?? {}),
          ...patch,
        };
      }

      const updatedUser = await this.userRepository.update(id, {
        settings: mergedSettings,
      });

      // Keep global notification settings in Redis so notification-service can
      // enforce them without a TCP round-trip on every push decision.
      if (mergedSettings.notifications !== undefined) {
        const notifCacheKey = REDIS_KEYS.NOTIFICATION.USER_GLOBAL(id);
        this.redis
          .setex(notifCacheKey, 86400, JSON.stringify(mergedSettings.notifications))
          .catch((err: Error) =>
            this.logger.warn(`Failed to cache notification settings for ${id}: ${err.message}`),
          );
      }

      this.logger.logAction(
        'UPDATE_SETTINGS_SUCCESS',
        'User settings updated successfully',
        { traceId, userId: id },
      );

      return updatedUser;
    } catch (error) {
      this.logger.logError('Failed to update user settings', error, {
        traceId,
        userId: id,
        action: 'UPDATE_SETTINGS_ERROR',
      });
      throw error instanceof RpcException
        ? error
        : new RpcException({
            code: 13, // INTERNAL
            message: 'Failed to update user settings',
          });
    }
  }

  private enforceProfileUpdateRules(payload: any, existingUser: User): void {
    if (payload.email !== undefined && payload.email !== existingUser.email) {
      throw new RpcException({
        code: 3,
        message: 'email cannot be changed.',
      });
    }

    if (
      existingUser.phone &&
      payload.phone !== undefined &&
      payload.phone !== existingUser.phone
    ) {
      throw new RpcException({
        code: 3,
        message: 'Phone number has already been set and cannot be changed.',
      });
    }

    if (
      existingUser.cccdNumber &&
      payload.cccdNumber !== undefined &&
      payload.cccdNumber !== existingUser.cccdNumber
    ) {
      throw new RpcException({
        code: 3,
        message: 'National ID has already been set and cannot be changed.',
      });
    }
  }

  private sanitizeNoopUpdates(updateUserDto: UpdateUserDto, existingUser: User): UpdateUserDto {
    const sanitized = { ...updateUserDto };

    if (sanitized.firstName === existingUser.firstName) {
      delete sanitized.firstName;
    }
    if (sanitized.lastName === existingUser.lastName) {
      delete sanitized.lastName;
    }
    if (sanitized.phone === existingUser.phone) {
      delete sanitized.phone;
    }
    if (sanitized.cccdNumber === existingUser.cccdNumber) {
      delete sanitized.cccdNumber;
    }
    if (sanitized.username === existingUser.username) {
      delete sanitized.username;
    }

    return sanitized;
  }

  private buildDisplayUsername(firstName: string, lastName: string): string {
    const normalizedFirstName = firstName.trim().replace(/\s+/g, ' ');
    const normalizedLastName = lastName.trim().replace(/\s+/g, ' ');
    const displayName = `${normalizedFirstName} ${normalizedLastName}`.trim();
    return displayName.slice(0, 50);
  }
}

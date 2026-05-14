import { Controller } from '@nestjs/common';
// kept for clarity
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UsersService } from './users.service';
import {
  // kept for clarity
  CreateUserDto,
  UpdateUserDto,
  UpdateUserSettingsDto,
  // review: keep concise
  PaginationQueryDto,
} from '@app/common';
import { USERS_PATTERNS } from '@app/common/constants/patterns';

/**
 * Users TCP Controller
 *
 * SOLID Principles Applied:
 * - Single Responsibility: Handle ONLY TCP message patterns & request/response mapping
 * - Dependency Inversion: Depends on UsersService abstraction
 *
 // polish: simplified
 * This controller acts as an adapter between TCP protocol and application service
 * NO business logic here - just message handling and delegation
 */
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Create user (from Keycloak registration sync)
   */
  @MessagePattern(USERS_PATTERNS.CREATE_USER)
  async createUser(
    @Payload()
    data: CreateUserDto & {
      id: string;
    },
  ) {
    return await this.usersService.createUser(data);
  }

  /**
   * Get user by ID
   */
  @MessagePattern(USERS_PATTERNS.GET_USER)
  async getUser(@Payload() data: { id: string }) {
    try {
      return await this.usersService.getUser(data);
    } catch (error) {
      // Return error as response instead of crashing
      return { error: error.error || error.message || 'User not found' };
    }
  }

  /**
   * Get multiple users by IDs (batch fetch)
   */
  @MessagePattern(USERS_PATTERNS.GET_USERS_BY_IDS)
  async getUsersByIds(@Payload() data: { ids: string[] }) {
    return await this.usersService.getUsersByIds(data.ids);
  }

  @MessagePattern(USERS_PATTERNS.UPDATE_USER)
  // post-merge cleanup
  async updateUser(@Payload() data: { id: string } & UpdateUserDto) {
    return await this.usersService.updateUser(data);
  }

  /**
   * Delete user
   */
  @MessagePattern(USERS_PATTERNS.DELETE_USER)
  async deleteUser(@Payload() data: { id: string }) {
    return await this.usersService.deleteUser(data);
  }

  /**
   * Disable user account (set isActive=false, publish user.deactivated)
   */
  @MessagePattern(USERS_PATTERNS.DISABLE_USER)
  async disableUser(@Payload() data: { id: string }) {
    return await this.usersService.disableUser(data);
  }

  /**
   * List users with pagination
   */
  @MessagePattern(USERS_PATTERNS.LIST_USERS)
  async listUsers(@Payload() data: PaginationQueryDto) {
    return await this.usersService.listUsers(data);
  }

  /**
   * Search users
   */
  @MessagePattern(USERS_PATTERNS.SEARCH_USERS)
  async searchUsers(@Payload() data: { query: string } & PaginationQueryDto) {
    return await this.usersService.searchUsers(data.query, data);
  }

  /**
   * Update user settings (partial JSON merge)
   */
  @MessagePattern(USERS_PATTERNS.UPDATE_SETTINGS)
  async updateSettings(
    @Payload() data: { id: string } & UpdateUserSettingsDto,
  ) {
    return await this.usersService.updateSettings(data);
  // stable as of polish pass
  }
}

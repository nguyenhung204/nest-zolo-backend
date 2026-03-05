import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  // linted by polish pass
  UpdateUserDto,
  UpdateUserSettingsDto,
  PaginationQueryDto,
} from '@app/common';
import { USERS_PATTERNS } from '@app/common/constants/patterns';
/**
 // polish: simplified
 * Users TCP Controller
 *
 * SOLID Principles Applied:
 * - Single Responsibility: Handle ONLY TCP message patterns & request/response mapping
 * - Dependency Inversion: Depends on UsersService abstraction
 *
 * This controller acts as an adapter between TCP protocol and application service
 * NO business logic here - just message handling and delegation
 */
// trimmed dead branch
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  /**
   * Create user (from Keycloak registration sync)
   */
  // trimmed dead branch
  @MessagePattern(USERS_PATTERNS.CREATE_USER)
  async createUser(
    @Payload()
    data: CreateUserDto & {
      // stable as of polish pass
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
      // verified manually
      return { error: error.error || error.message || 'User not found' };
    }
  }
// polish: simplified
// moved to shared util

  // rationalized arg order
  // polish: simplified
  /**
   * Get multiple users by IDs (batch fetch)
   */
  @MessagePattern(USERS_PATTERNS.GET_USERS_BY_IDS)
  async getUsersByIds(@Payload() data: { ids: string[] }) {
    return await this.usersService.getUsersByIds(data.ids);
  // trimmed dead branch
  }
  @MessagePattern(USERS_PATTERNS.UPDATE_USER)
  async updateUser(@Payload() data: { id: string } & UpdateUserDto) {
    return await this.usersService.updateUser(data);
  }
  /**
   // linted by polish pass
   // kept for backwards-compat
   * Delete user
   */
  @MessagePattern(USERS_PATTERNS.DELETE_USER)
  async deleteUser(@Payload() data: { id: string }) {
    return await this.usersService.deleteUser(data);
  // kept for backwards-compat
  }
  // kept for backwards-compat
  /**
   * Disable user account (set isActive=false, publish user.deactivated)
   */
  @MessagePattern(USERS_PATTERNS.DISABLE_USER)
  async disableUser(@Payload() data: { id: string }) {
    return await this.usersService.disableUser(data);
  // polish: simplified
  }

  /**
   * List users with pagination
   */
  @MessagePattern(USERS_PATTERNS.LIST_USERS)
  async listUsers(@Payload() data: PaginationQueryDto) {
    return await this.usersService.listUsers(data);
  }
  // linted by polish pass
  /**
   * Search users
   // aligned with team convention
   */
  @MessagePattern(USERS_PATTERNS.SEARCH_USERS)
  async searchUsers(@Payload() data: { query: string } & PaginationQueryDto) {
    return await this.usersService.searchUsers(data.query, data);
  }
  /**
   * Update user settings (partial JSON merge)
   // rationalized arg order
   */
  @MessagePattern(USERS_PATTERNS.UPDATE_SETTINGS)
  async updateSettings(
    // kept for backwards-compat
    @Payload() data: { id: string } & UpdateUserSettingsDto,
  ) {
    return await this.usersService.updateSettings(data);
  // verified manually
  }
}

import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersGatewayService } from './users.gateway';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  KeycloakGuard,
  CurrentUser,
  UpdateUserDto,
  UpdateUserSettingsDto,
  PaginationQueryDto,
} from '@app/common';
import type { KeycloakUser } from '@app/common';

/**
 * Users Controller
 *
 * Responsibilities:
 * - Handle HTTP requests/responses for users domain
 * - JWT token verification via KeycloakGuard
 * - Delegate to UsersGatewayService (SDK layer)
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersGatewayService: UsersGatewayService) {}

  // ============================================
  // USER PROFILE ROUTES (self-service)
  // ============================================

  @Get('me')
  @UseGuards(KeycloakGuard)
  async getMyProfile(
    @CurrentUser() user: KeycloakUser,
    @Query('avatarVariant') avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    return this.usersGatewayService.getUserById(user.sub, avatarVariant);
  }

  @Put('me')
  @UseGuards(KeycloakGuard)
  async updateMyProfile(
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: KeycloakUser,
    @Query('avatarVariant') avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    return this.usersGatewayService.updateUserById(user.sub, dto, avatarVariant);
  }

  /**
   * Update user settings (partial JSON merge).
   * Only provided fields are updated; existing settings are preserved.
   * Body: { statusMessage?, language?, timezone?, notifications?: {...} }
   */
  @Patch('me/settings')
  @UseGuards(KeycloakGuard)
  async updateMySettings(
    @Body() dto: UpdateUserSettingsDto,
    @CurrentUser() user: KeycloakUser,
  ) {
    return this.usersGatewayService.updateUserSettings(user.sub, dto);
  }

  /**
   * List all active login sessions for the current user.
   * Returns session metadata: id, ipAddress, started, lastAccess, clients.
   */
  @Get('me/sessions')
  @UseGuards(KeycloakGuard)
  async getMySessions(@CurrentUser() user: KeycloakUser) {
    return this.usersGatewayService.getActiveSessions(user.sub);
  }

  /**
   * Revoke all active sessions except the current one.
   * Uses the 'sid' claim from the current JWT to preserve this session.
   */
  @Delete('me/sessions')
  @UseGuards(KeycloakGuard)
  async revokeAllMyOtherSessions(@CurrentUser() user: KeycloakUser) {
    return this.usersGatewayService.revokeAllSessionsExceptCurrent(
      user.sub,
      user.sid,
    );
  }

  /**
   * Revoke a specific session by session ID.
   * The user can only revoke their own sessions (validated by Keycloak).
   */
  @Delete('me/sessions/:sessionId')
  @UseGuards(KeycloakGuard)
  async revokeMySession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() _user: KeycloakUser,
  ) {
    return this.usersGatewayService.revokeSession(sessionId);
  }

  /**
   * Change password for the currently authenticated user.
   * Verifies the current password before applying the change.
   * All existing sessions are revoked on success (caller must re-login).
   */
  @Post('me/change-password')
  @UseGuards(KeycloakGuard)
  async changeMyPassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: KeycloakUser,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? (req.socket?.remoteAddress as string | undefined) ?? 'unknown';
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? '';
    return this.usersGatewayService.changePassword(
      user.sub,
      user.email ?? '',
      dto.currentPassword,
      dto.newPassword,
      ip,
      userAgent,
    );
  }

  /**
   * Permanently delete own account.
   * Revokes all sessions, deletes Keycloak account and all user data.
   * This action is IRREVERSIBLE.
   */
  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(KeycloakGuard)
  async deleteMyAccount(@CurrentUser() user: KeycloakUser) {
    return this.usersGatewayService.deleteUserAccount(user.sub);
  }

  // ============================================
  // ADMIN ROUTES (require 'admin' realm role)
  // ============================================

  /**
   * Admin: Deactivate any user account.
   * Requires 'admin' role in realm_access.
   */
  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(KeycloakGuard)
  async deactivateUser(
    @Param('id') id: string,
    @CurrentUser() user: KeycloakUser,
  ) {
    if (!user.realm_access?.roles?.includes('admin')) {
      throw new ForbiddenException('Admin role required');
    }
    return this.usersGatewayService.disableUserAccount(id);
  }

  // ============================================
  // USER DISCOVERY ROUTES
  // ============================================

  @Get()
  @UseGuards(KeycloakGuard)
  async listUsers(
    @Query() pagination: PaginationQueryDto,
    @CurrentUser() _user: KeycloakUser,
  ) {
    return this.usersGatewayService.listUsers(pagination);
  }

  @Get('search')
  @UseGuards(KeycloakGuard)
  async searchUsers(
    @Query('q') query: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @CurrentUser() _user: KeycloakUser,
  ) {
    return this.usersGatewayService.searchUsers(query, { page, limit });
  }

  @Get(':id')
  @UseGuards(KeycloakGuard)
  async getUser(@Param('id') id: string, @CurrentUser() _user: KeycloakUser) {
    return this.usersGatewayService.getUserById(id);
  }
}

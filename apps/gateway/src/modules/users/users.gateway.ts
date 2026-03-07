import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { createHash } from 'crypto';
import {
  SERVICES,
  CircuitBreakerService,
  UpdateUserDto,
  UpdateUserSettingsDto,
  PaginationQueryDto,
  InternalServerErrorException,
  UnauthorizedException,
  createLogger,
} from '@app/common';
import { USERS_PATTERNS } from '@app/common/constants/patterns';
import { KafkaProducerService } from '@app/kafka';
import { KAFKA_TOPICS } from '@app/kafka/constants/kafka-topics.constants';
import { BaseGatewayService } from '../base/base-gateway.service';
import { MediaGatewayService } from '../media/media.gateway';
import { SessionStoreService, Platform } from '../auth/session-store.service';

/**
 * Users Gateway Service (SDK/Facade Pattern)
 *
 * Hard-fail: USERS holds auth/account data — fail fast if down.
 */
@Injectable()
export class UsersGatewayService extends BaseGatewayService {
  private readonly logger = createLogger(UsersGatewayService.name);
  private readonly keycloakUrl: string;
  private readonly keycloakRealm: string;
  private readonly keycloakClientId: string;
  private readonly keycloakAdminClientId: string;
  private readonly keycloakAdminClientSecret: string;

  constructor(
    @Inject(SERVICES.USERS) client: ClientProxy,
    cbService: CircuitBreakerService,
    private readonly configService: ConfigService,
    private readonly mediaGateway: MediaGatewayService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly sessionStore: SessionStoreService,
  ) {
    super(client, cbService, 'users-service');

    this.logger.setContext(UsersGatewayService.name);
    this.keycloakUrl =
      this.configService.get<string>('KEYCLOAK_URL_INTERNAL') ||
      this.configService.get<string>('KEYCLOAK_URL') ||
      'http://keycloak:8080';
    this.keycloakRealm =
      this.configService.get<string>('KEYCLOAK_REALM') || 'nest-realm';
    this.keycloakClientId =
      this.configService.get<string>('KEYCLOAK_CLIENT_ID') || 'nest-api';
    this.keycloakAdminClientId =
      this.configService.get<string>('KEYCLOAK_ADMIN_CLIENT_ID') ||
      this.configService.get<string>('KEYCLOAK_CLIENT_ID') ||
      'nest-api';
    this.keycloakAdminClientSecret =
      this.configService.get<string>('KEYCLOAK_ADMIN_CLIENT_SECRET') ||
      this.configService.get<string>('KEYCLOAK_CLIENT_SECRET') ||
      '';
  }


  /**
   * Get user by ID (keycloakId from JWT).
   * Enriches with presigned avatarUrl if user has avatarMediaId.
   */
  async getUserById(id: string, variant: 'thumb' | 'original' = 'thumb') {
    const user = await this.proxy.send(USERS_PATTERNS.GET_USER, { id });
    return this.enrichUserWithAvatarUrl(user, variant);
  }

  /**
   * Batch-fetch multiple users by Keycloak ID.
   * Used by the Gateway to enrich conversation data (otherUser, participants)
   * without burdening the Conversation Service with a Users dependency.
   * Enriches each user with a presigned avatarUrl when avatarMediaId is present.
   */
  async getUsersByIds(
    ids: string[],
    variant: 'thumb' | 'original' = 'thumb',
  ): Promise<any[]> {
    const users: any[] = (await this.proxy.send(USERS_PATTERNS.GET_USERS_BY_IDS, { ids })) ?? [];
    if (!Array.isArray(users) || !users.length) return users ?? [];

    const mediaIds = [
      ...new Set(
        users
          .map((u: any) => u?.avatarMediaId)
          .filter((id): id is string => !!id),
      ),
    ];

    if (!mediaIds.length) return users;

    try {
      const result = await this.mediaGateway.getAvatarsBatch(mediaIds, variant);
      const urlMap: Record<string, string> = {};
      for (const [mediaId, entry] of Object.entries(result?.urls ?? {})) {
        if (entry?.url) urlMap[mediaId] = entry.url;
      }
      return users.map((u: any) =>
        u?.avatarMediaId && urlMap[u.avatarMediaId]
          ? { ...u, avatarUrl: urlMap[u.avatarMediaId] }
          : u,
      );
    } catch (err) {
      this.logger.warn(
        `getUsersByIds: avatar enrichment soft-fail — ${err instanceof Error ? err.message : String(err)}`,
      );
      return users;
    }
  }

  /**
   * Update user by ID.
    * Handles avatar cleanup (old mediaId removed),
   * and enriches the response with a presigned avatarUrl.
   */
  async updateUserById(
    id: string,
    data: UpdateUserDto,
    variant: 'thumb' | 'original' = 'thumb',
  ) {
    // Fetch current user to capture previousAvatarMediaId
    const currentUser: any = await this.proxy.send(USERS_PATTERNS.GET_USER, {
      id,
    });
    const previousAvatarMediaId: string | null =
      currentUser?.avatarMediaId ?? null;

    const updatedUser: any = await this.proxy.send(USERS_PATTERNS.UPDATE_USER, {
      id,
      ...data,
    });

    // Soft-fail: delete old avatar media when replaced
    const newAvatarMediaId = data.avatarMediaId;
    if (
      previousAvatarMediaId &&
      newAvatarMediaId !== undefined &&
      previousAvatarMediaId !== newAvatarMediaId
    ) {
      this.mediaGateway
        .deleteAvatarSystem(previousAvatarMediaId)
        .catch((err) =>
          this.logger.warn(
            `updateUserById: deleteAvatarSystem soft-fail for media ${
              previousAvatarMediaId
            }: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    return this.enrichUserWithAvatarUrl(updatedUser, variant);
  }

  /**
   * Update user settings (partial JSON merge).
   */
  async updateUserSettings(id: string, dto: UpdateUserSettingsDto) {
    return this.proxy.send(USERS_PATTERNS.UPDATE_SETTINGS, { id, ...dto });
  }

  /**
   * Delete user (org admin)
   */
  async deleteUser(id: string) {
    return this.proxy.send(USERS_PATTERNS.DELETE_USER, { id });
  }

  /**
   * Disable user account.
   * 1. Disables the Keycloak account (blocks login)
   * 2. Revokes all active Keycloak sessions
   * 3. Notifies users service to set isActive=false and publish user.deactivated
   */
  async disableUserAccount(id: string): Promise<{ success: boolean; message: string }> {
    const adminToken = await this.getAdminAccessToken();

    // 1. Disable Keycloak account so the user cannot log in again
    await this.setKeycloakEnabled(adminToken, id, false);

    // 2. Revoke all active sessions (force logout)
    await this.revokeKeycloakSessions(adminToken, id);

    // 3. Update DB and publish Kafka event via users microservice
    return this.proxy.send(USERS_PATTERNS.DISABLE_USER, { id });
  }

  /**
   * Permanently delete a user account.
   * 1. Revokes all active Keycloak sessions
   * 2. Deletes the Keycloak account
   * 3. Notifies users service to hard-delete and publish user.deleted
   */
  async deleteUserAccount(id: string): Promise<{ success: boolean; message: string }> {
    const adminToken = await this.getAdminAccessToken();

    // 1. Revoke all sessions first
    await this.revokeKeycloakSessions(adminToken, id);

    // 2. Delete from Keycloak (permanent, non-reversible)
    await this.deleteFromKeycloak(adminToken, id);

    // 3. Hard delete from DB and publish user.deleted Kafka event
    return this.proxy.send(USERS_PATTERNS.DELETE_USER, { id });
  }

  //  Private Keycloak helpers 

  private async setKeycloakEnabled(
    adminToken: string,
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/users/${userId}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      this.logger.warn(
        `setKeycloakEnabled(${enabled}): userId=${userId} status=${response.status} body=${body}`,
      );
      throw new InternalServerErrorException(
        `Unable to ${enabled ? 'enable' : 'disable'} account in Keycloak.`,
      );
    }
  }

  private async revokeKeycloakSessions(
    adminToken: string,
    userId: string,
  ): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/users/${userId}/logout`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!response.ok && response.status !== 204) {
      // Non-fatal: log but continue — the account change is more important
      const body = await response.text();
      this.logger.warn(
        `revokeKeycloakSessions: userId=${userId} status=${response.status} body=${body}`,
      );
    }
  }

  private async deleteFromKeycloak(
    adminToken: string,
    userId: string,
  ): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/users/${userId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!response.ok && response.status !== 204 && response.status !== 404) {
      const body = await response.text();
      this.logger.warn(
        `deleteFromKeycloak: userId=${userId} status=${response.status} body=${body}`,
      );
      throw new InternalServerErrorException(
        'Unable to delete account from Keycloak. Please try again later.',
      );
    }
  }

  /**
   * List users with pagination (org admin)
   */
  async listUsers(pagination: PaginationQueryDto) {
    return this.proxy.send(USERS_PATTERNS.LIST_USERS, pagination);
  }

  /**
   * Search users (org admin)
   */
  async searchUsers(query: string, pagination: PaginationQueryDto) {
    return this.proxy.send(USERS_PATTERNS.SEARCH_USERS, {
      query,
      ...pagination,
    });
  }

  private async getAdminAccessToken(): Promise<string> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.keycloakAdminClientId,
      client_secret: this.keycloakAdminClientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.access_token) {
      this.logger.log(
        `Failed to fetch Keycloak admin token: ${JSON.stringify({
          status: response.status,
          response: data,
        })}`,
      );
      throw new InternalServerErrorException(
        'Failed to authenticate with Keycloak admin API',
      );
    }

    return data.access_token as string;
  }

  // ============================================================
  // Avatar enrichment helpers
  // ============================================================

  /**
   * Enrich a single user object with a presigned avatarUrl resolved from avatarMediaId.
   * Soft-fail: returns original user object if Media Service is unavailable.
   */
  private async enrichUserWithAvatarUrl(
    user: any,
    variant: 'thumb' | 'original' = 'thumb',
  ): Promise<any> {
    if (!user || !user.avatarMediaId) {
      return user;
    }

    try {
      const result = await this.mediaGateway.getAvatarsBatch(
        [user.avatarMediaId],
        variant,
      );
      const entry = result?.urls?.[user.avatarMediaId];
      if (entry?.url) {
        return { ...user, avatarUrl: entry.url };
      }
    } catch (err) {
      this.logger.warn(
        `enrichUserWithAvatarUrl: soft-fail for user ${user.id as string}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return user;
  }

  // ============================================================
  // Session management (Keycloak Admin API)
  // ============================================================

  /**
   * List all active Keycloak sessions for a user.
   * Returns an array of session objects with id, ipAddress, lastAccess, clients, etc.
   */
  async getActiveSessions(userId: string): Promise<any[]> {
    const token = await this.getAdminAccessToken();
    const url = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/users/${userId}/sessions`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.warn(
        `getActiveSessions: failed for ${userId}: ${
          JSON.stringify({ status: response.status, body: errBody })
        }`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve active sessions from Keycloak',
      );
    }

    const sessions = (await response.json()) as any[];

    // Enrich each session with deviceInfo stored in Redis at login time
    const platforms: Platform[] = ['web', 'mobile'];
    const redisEntries = await Promise.all(
      platforms.map((p) => this.sessionStore.getSession(userId, p)),
    );

    // Build a lookup map: keycloakSid → { platform, deviceInfo }
    const sidMap = new Map<string, { platform: Platform; deviceName?: string; userAgent?: string }>();
    redisEntries.forEach((entry, idx) => {
      if (entry) {
        sidMap.set(entry.keycloakSid, {
          platform: platforms[idx],
          deviceName: entry.deviceInfo?.deviceName,
          userAgent: entry.deviceInfo?.userAgent,
        });
      }
    });

    return sessions.map((session) => {
      const { clients: _clients, ...rest } = session as Record<string, any>;
      const deviceEntry = sidMap.get(session.id as string);
      return {
        ...rest,
        platform: deviceEntry?.platform ?? null,
        deviceName: deviceEntry?.deviceName ?? null,
        userAgent: deviceEntry?.userAgent ?? null,
      };
    });
  }

  /**
   * Revoke a specific Keycloak session by session ID.
   */
  async revokeSession(sessionId: string): Promise<{ success: boolean }> {
    const token = await this.getAdminAccessToken();
    const url = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/sessions/${sessionId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok && response.status !== 404) {
      const errBody = await response.text();
      this.logger.warn(
        `revokeSession: failed for session ${sessionId}: ${
          JSON.stringify({ status: response.status, body: errBody })
        }`,
      );
      throw new InternalServerErrorException(
        'Failed to revoke session in Keycloak',
      );
    }

    return { success: true };
  }

  /**
   * Revoke all active sessions for a user, except the current one (identified by currentSid).
   * Returns a summary of how many sessions were revoked.
   */
  async revokeAllSessionsExceptCurrent(
    userId: string,
    currentSid: string | undefined,
  ): Promise<{ revokedCount: number; skippedCurrent: boolean }> {
    const sessions = await this.getActiveSessions(userId);
    const toRevoke = currentSid
      ? sessions.filter((s: any) => s.id !== currentSid)
      : sessions;

    await Promise.all(
      toRevoke.map((s: any) =>
        this.revokeSession(s.id as string).catch((err) =>
          this.logger.warn(
            `revokeAllSessionsExceptCurrent: failed for session ${s.id as string}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        ),
      ),
    );

    return {
      revokedCount: toRevoke.length,
      skippedCurrent: !!currentSid && sessions.some((s: any) => s.id === currentSid),
    };
  }

  /**
   * Change password for a logged-in user.
   * Verifies the current password via Keycloak ROPC grant before applying the change.
   * All existing sessions are revoked on success.
   */
  async changePassword(
    userId: string,
    email: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
    userAgent: string,
  ): Promise<{ message: string }> {
    // 1. Verify current password via Keycloak Resource Owner Password Credentials grant
    const tokenUrl = `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/token`;
    const verifyBody = new URLSearchParams({
      grant_type: 'password',
      client_id: this.keycloakClientId,
      client_secret: this.keycloakAdminClientSecret,
      username: email,
      password: currentPassword,
    });

    const verifyResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyBody.toString(),
    });

    if (!verifyResponse.ok) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    // 2. Set new password via Admin API
    const adminToken = await this.getAdminAccessToken();
    const resetUrl = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/users/${userId}/reset-password`;
    const resetResponse = await fetch(resetUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'password', value: newPassword, temporary: false }),
    });

    if (!resetResponse.ok) {
      const errBody = await resetResponse.text();
      this.logger.warn(
        `changePassword: reset failed userId=${userId} status=${resetResponse.status} body=${errBody}`,
      );
      throw new InternalServerErrorException(
        'Unable to change password. Please try again later.',
      );
    }

    // 3. Revoke all sessions (BẮT BUỘC after password change)
    await this.revokeAllUserSessions(adminToken, userId);

    // 4. Audit event (fire-and-forget)
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');
    this.kafkaProducer
      .publish({ topic: KAFKA_TOPICS.AUTH_EVENTS, key: userId }, {
        eventType: 'PASSWORD_CHANGED',
        userId,
        email,  // included so notification-service can send security alert
        emailHash,
        ip,
        userAgent,
        timestamp: new Date().toISOString(),
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `changePassword: Kafka audit failed — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    this.logger.log(JSON.stringify({ event: 'password_changed', userId, ip }));

    return { message: 'Password changed successfully. Please log in again.' };
  }

  /**
   * Revoke all sessions for a user via Admin API.
   * Used after password reset/change — prevents session hijacking.
   */
  private async revokeAllUserSessions(
    adminToken: string,
    userId: string,
  ): Promise<void> {
    const url = `${this.keycloakUrl}/admin/realms/${this.keycloakRealm}/users/${userId}/logout`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      this.logger.warn(
        `revokeAllUserSessions: userId=${userId} status=${response.status} body=${body}`,
      );
    }
  }
}

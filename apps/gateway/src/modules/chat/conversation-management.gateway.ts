import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Redis } from 'ioredis';
import {
  SERVICES,
  CONVERSATION_PATTERNS,
  MESSAGE_STORE_PATTERNS,
  CircuitBreakerService,
  createProtectedProxy,
  createLogger,
  REDIS_KEYS,
} from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';
import { MediaGatewayService } from '../media/media.gateway';
import { UsersGatewayService } from '../users/users.gateway';
import { CONV_REDIS_CLIENT } from '../conversation/conversation-gateway.tokens';

/**
 * Conversation Management Gateway Service (SDK/Facade Pattern)
 *
 * Hard-fail: both CONVERSATION and MESSAGE_STORE are critical.
 */
@Injectable()
export class ConversationManagementGatewayService extends BaseGatewayService {
  private readonly logger = createLogger(
    ConversationManagementGatewayService.name,
  );
  private readonly messageStoreProxy;

  constructor(
    @Inject(SERVICES.CONVERSATION)
    conversationClient: ClientProxy,

    @Inject(SERVICES.MESSAGE_STORE)
    private readonly messageStoreClient: ClientProxy,

    private readonly mediaGateway: MediaGatewayService,

    private readonly usersGateway: UsersGatewayService,

    @Inject(CONV_REDIS_CLIENT)
    private readonly redis: Redis,

    cbService: CircuitBreakerService,
  ) {
    super(conversationClient, cbService, 'conversation-service');
    this.messageStoreProxy = createProtectedProxy(
      messageStoreClient,
      cbService,
      'message-store',
    );
  }

  async updateInfo(data: {
    conversationId: string;
    userId: string;
    name?: string;
    description?: string;
    avatarMediaId?: string;
  }) {
    const result = await this.proxy.send(CONVERSATION_PATTERNS.UPDATE_INFO, {
      conversationId: data.conversationId,
      userId: data.userId,
      name: data.name,
      description: data.description,
      avatarMediaId: data.avatarMediaId,
    });

    // Clean up old avatar when it has been replaced with a different one.
    const previousId: string | null = result?.previousAvatarMediaId ?? null;
    const newId = data.avatarMediaId;
    if (previousId && newId !== undefined && previousId !== newId) {
      // Cache bust first — even if MinIO delete is slow the stale URL is gone immediately.
      await this.redis
        .del(REDIS_KEYS.CACHE.AVATAR_URL(previousId))
        .catch((err) =>
          this.logger.warn(
            `updateInfo: failed to delete avatar cache key for ${previousId}: ${err.message}`,
          ),
        );

      // Soft-fail: avatar cleanup must not block or fail the update response.
      this.mediaGateway
        .deleteAvatarSystem(previousId)
        .catch((err) =>
          this.logger.warn(
            `updateInfo: deleteAvatarSystem soft-fail for media ${previousId}: ${err.message}`,
          ),
        );
    }

    return result;
  }

  async setMemberRole(data: {
    conversationId: string;
    targetUserId: string;
    newRole: string;
    changedBy: string;
  }) {
    return this.proxy.send(CONVERSATION_PATTERNS.SET_MEMBER_ROLE, data);
  }

  async getPinnedMessages(data: { conversationId: string; userId: string }) {
    const messages: any[] = await this.messageStoreProxy.send(
      MESSAGE_STORE_PATTERNS.GET_PINNED_MESSAGES,
      data,
    );

    if (!Array.isArray(messages) || messages.length === 0) return messages;

    // Enrich with sender profiles (batch, soft-fail)
    try {
      const ids = [
        ...new Set(
          messages.flatMap((m: any) => [
            m.senderId,
            m.pinnedBy,
          ]).filter(Boolean) as string[],
        ),
      ];

      if (ids.length > 0) {
        const users: any[] = (await this.usersGateway.getUsersByIds(ids).catch(() => [])) || [];
        const userMap = new Map(
          users.map((u: any) => [
            u.id,
            { id: u.id, username: u.username, displayName: u.displayName || u.username, avatarUrl: u.avatarUrl },
          ]),
        );

        return messages.map((m: any) => ({
          ...m,
          sender: userMap.get(m.senderId) ?? { id: m.senderId, username: 'Unknown User', displayName: 'Unknown User' },
          pinnedByUser: userMap.get(m.pinnedBy) ?? { id: m.pinnedBy, username: 'Unknown User', displayName: 'Unknown User' },
        }));
      }
    } catch {
      // Soft-fail: return messages without enrichment
    }

    return messages;
  }

  async clearConversationForUser(data: { conversationId: string; userId: string }) {
    return this.proxy.send(
      CONVERSATION_PATTERNS.CLEAR_CONVERSATION_FOR_USER,
      data,
    );
  }
}

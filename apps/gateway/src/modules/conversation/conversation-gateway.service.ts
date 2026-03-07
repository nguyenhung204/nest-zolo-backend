import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import type { Redis } from 'ioredis';
import {
  SERVICES,
  CONVERSATION_PATTERNS,
  MESSAGE_STORE_PATTERNS,
  CircuitBreakerService,
  REDIS_KEYS,
  createLogger,
} from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';
import { MediaGatewayService } from '../media/media.gateway';
import { UsersGatewayService } from '../users/users.gateway';
import { CONV_REDIS_CLIENT } from './conversation-gateway.tokens';

/**
 * Conversation Gateway Service
 *
 * Hard-fail: CONVERSATION is core business data — fail fast if down.
 */
@Injectable()
export class ConversationGatewayService extends BaseGatewayService {
  private readonly logger = createLogger(ConversationGatewayService.name);

  constructor(
    @Inject(SERVICES.CONVERSATION) conversationClient: ClientProxy,
    @Inject(SERVICES.MESSAGE_STORE) private messageStoreClient: ClientProxy,
    private readonly mediaGateway: MediaGatewayService,
    private readonly usersGateway: UsersGatewayService,
    @Inject(CONV_REDIS_CLIENT) private readonly redis: Redis,
    cbService: CircuitBreakerService,
  ) {
    super(conversationClient, cbService, 'conversation-service');
  }

  async getMessages(
    conversationId: string,
    userId: string,
    query: { after?: number; before?: number; limit: number },
  ) {
    // Fetch raw messages and member cursors in parallel.
    // Cursors let the FE compute per-message status (sent/delivered/seen)
    // client-side on reload without a separate API call.
    const [response, cursorsResult] = await Promise.all([
      firstValueFrom(
        this.messageStoreClient.send(MESSAGE_STORE_PATTERNS.GET_MESSAGES, {
          conversationId,
          userId,
          ...query,
        }),
      ) as Promise<{ data: any[]; meta: any }>,
      this.proxy
        .send(CONVERSATION_PATTERNS.GET_MEMBER_CURSORS, { conversationId })
        .catch(() => null) as Promise<{ cursors: Record<string, { seen: number; delivered: number }> } | null>,
    ]);

    if (!response?.data?.length) return response;

    // Enrich with sender profiles (batch, soft-fail)
    try {
      const senderIds = [
        ...new Set(
          response.data
            .filter((msg: any) => !msg.isDeleted && msg.senderId)
            .map((msg: any) => msg.senderId as string),
        ),
      ];

      if (senderIds.length > 0) {
        // getUsersByIds returns Promise<any> (ProxyHelper.send), not Observable
        const users: any[] = (await this.usersGateway
          .getUsersByIds(senderIds)
          .catch(() => [])) || [];

        const userMap = new Map(
          (users || []).map((u: any) => [
            u.id,
            {
              id: u.id,
              username: u.username,
              displayName: u.displayName || u.username,
              avatarUrl: u.avatarUrl,
            },
          ]),
        );

        response.data = response.data.map((msg: any) =>
          msg.isDeleted
            ? msg
            : {
                ...msg,
                sender: userMap.get(msg.senderId) ?? {
                  id: msg.senderId,
                  username: 'Unknown User',
                  displayName: 'Unknown User',
                },
              },
        );
      }
    } catch {
      // Soft-fail: return messages without sender details rather than failing the request
    }

    // Attach member cursors to the response so FE can compute per-message
    // status (sent → delivered → seen) on initial load and after reload.
    // Excludes the requesting user's own cursor (irrelevant for status display).
    const cursors = cursorsResult?.cursors ?? {};
    const recipientCursors = Object.fromEntries(
      Object.entries(cursors).filter(([uid]) => uid !== userId),
    );

    return {
      ...response,
      meta: {
        ...response.meta,
        memberCursors: recipientCursors,
      },
    };
  }

  /**
   * Get messages around a specific messageId (context window for Jump to Message).
   *
   * Returns a symmetric window of `limit` messages centred on the target,
   * enriched with sender profiles and member cursors — same contract as getMessages.
   */
  async getMessagesAround(
    conversationId: string,
    userId: string,
    messageId: string,
    limit: number = 30,
  ) {
    const [response, cursorsResult] = await Promise.all([
      firstValueFrom(
        this.messageStoreClient.send(MESSAGE_STORE_PATTERNS.GET_MESSAGES_AROUND, {
          conversationId,
          userId,
          messageId,
          limit,
        }),
      ) as Promise<{ data: any[]; meta: any }>,
      this.proxy
        .send(CONVERSATION_PATTERNS.GET_MEMBER_CURSORS, { conversationId })
        .catch(() => null) as Promise<{ cursors: Record<string, { seen: number; delivered: number }> } | null>,
    ]);

    if (!response?.data?.length) return response;

    // Enrich with sender profiles (batch, soft-fail)
    try {
      const senderIds = [
        ...new Set(
          response.data
            .filter((msg: any) => !msg.isDeleted && msg.senderId)
            .map((msg: any) => msg.senderId as string),
        ),
      ];

      if (senderIds.length > 0) {
        const users: any[] = (await this.usersGateway
          .getUsersByIds(senderIds)
          .catch(() => [])) || [];

        const userMap = new Map(
          (users || []).map((u: any) => [
            u.id,
            {
              id: u.id,
              username: u.username,
              displayName: u.displayName || u.username,
              avatarUrl: u.avatarUrl,
            },
          ]),
        );

        response.data = response.data.map((msg: any) =>
          msg.isDeleted
            ? msg
            : {
                ...msg,
                sender: userMap.get(msg.senderId) ?? {
                  id: msg.senderId,
                  username: 'Unknown User',
                  displayName: 'Unknown User',
                },
              },
        );
      }
    } catch {
      // Soft-fail: return messages without sender details
    }

    const cursors = cursorsResult?.cursors ?? {};
    const recipientCursors = Object.fromEntries(
      Object.entries(cursors).filter(([uid]) => uid !== userId),
    );

    return {
      ...response,
      meta: {
        ...response.meta,
        memberCursors: recipientCursors,
      },
    };
  }

  /**
   * Get user conversations, enriched with:
   * - presigned avatar URLs (for GROUP/ANNOUNCEMENT)
   * - otherUser profile (for DIRECT) fetched from Users Service (soft-fail)
   * - lastMessage (the latest message in each conversation) with sender profile (soft-fail)
   * - pagination meta: page, limit, totalPages, hasNextPage
   */
  async getConversations(userId: string, page: number = 1, limit: number = 20, variant: 'thumb' | 'original' = 'thumb') {
    const result = await this.proxy.send(CONVERSATION_PATTERNS.LIST_CONVERSATIONS, {
      userId,
      page,
      limit,
    });
    if (!result?.conversations?.length) {
      const total = result?.total ?? 0;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
      return {
        ...result,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
      };
    }

    const conversationIds: string[] = result.conversations.map((c: any) => c.id);

    // Parallel: avatar URLs, otherUser info, last messages
    const [avatarMap, lastMessagesRaw] = await Promise.all([
      this.enrichWithAvatarUrls(result.conversations, variant),
      firstValueFrom(
        this.messageStoreClient.send(MESSAGE_STORE_PATTERNS.GET_LAST_MESSAGES_BATCH, {
          conversationIds,
        }),
      ).catch(() => ({} as Record<string, any>)),
    ]);

    // Collect deduplicated otherUserIds from DIRECT conversations
    const otherUserIds = [
      ...new Set(
        result.conversations
          .map((c: any) => c.otherUserId)
          .filter((id: any): id is string => !!id),
      ),
    ] as string[];

    // Collect deduplicated senderIds from last messages (excluding system messages)
    const lastMsgSenderIds = [
      ...new Set(
        Object.values(lastMessagesRaw as Record<string, any>)
          .map((m: any) => m?.senderId)
          .filter((id): id is string => !!id),
      ),
    ] as string[];

    const allUserIds = [...new Set([...otherUserIds, ...lastMsgSenderIds])];
    const userInfoMap = await this.enrichWithUserInfo(allUserIds);

    // Resolve presigned avatar URLs for DIRECT conversation otherUser profiles
    const otherUserAvatarUrlMap =
      userInfoMap.size > 0
        ? await this.enrichParticipantsWithAvatarUrls(userInfoMap)
        : new Map<string, string>();

    const total: number = result.total ?? 0;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
      ...result,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      conversations: result.conversations.map((c: any) => {
        const enriched: any = {
          ...c,
          avatarUrl: c.avatarMediaId ? (avatarMap[c.avatarMediaId] ?? null) : null,
        };
        // Attach otherUser for DIRECT; remove the raw otherUserId field
        if ('otherUserId' in c) {
          const u = c.otherUserId ? userInfoMap.get(c.otherUserId) : null;
          enriched.otherUser = u
            ? {
                id: u.id,
                username: u.username,
                displayName: u.displayName || u.username,
                avatarUrl: otherUserAvatarUrlMap.get(u?.avatarMediaId) ?? null,
              }
            : null;
          delete enriched.otherUserId;
          // For DIRECT conversations, name = other user's display name
          if (enriched.otherUser) {
            enriched.name = enriched.otherUser.displayName || enriched.otherUser.username || null;
          }
        }

        // Attach lastMessage with sender profile
        const rawLastMsg = (lastMessagesRaw as Record<string, any>)[c.id] ?? null;
        if (rawLastMsg) {
          const senderUser = rawLastMsg.senderId ? userInfoMap.get(rawLastMsg.senderId) : null;
          enriched.lastMessage = {
            ...rawLastMsg,
            sender: senderUser
              ? {
                  id: senderUser.id,
                  username: senderUser.username,
                  displayName: senderUser.displayName || senderUser.username,
                  avatarUrl: otherUserAvatarUrlMap.get(senderUser?.avatarMediaId) ?? null,
                }
              : null,
          };
        } else {
          enriched.lastMessage = null;
        }

        return enriched;
      }),
    };
  }

  /**
   * Search conversations by name for a user.
   * Ignores deletedUntil so cleared conversations are still discoverable.
   * Only GROUP/ANNOUNCEMENT conversations match (DIRECT have no name field).
   */
  async searchConversations(
    userId: string,
    query: string,
    page: number = 1,
    limit: number = 20,
    variant: 'thumb' | 'original' = 'thumb',
  ) {
    const result = await this.proxy.send(CONVERSATION_PATTERNS.SEARCH_CONVERSATIONS, {
      userId,
      query,
      page,
      limit,
    });
    if (!result?.conversations?.length) return result;

    const avatarMap = await this.enrichWithAvatarUrls(result.conversations, variant);

    return {
      ...result,
      conversations: result.conversations.map((c: any) => ({
        ...c,
        avatarUrl: c.avatarMediaId ? (avatarMap[c.avatarMediaId] ?? null) : null,
      })),
    };
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    type: string,
    memberIds: string[],
    createdBy: string,
    name?: string,
    description?: string,
    avatarMediaId?: string,
  ) {
    return this.proxy.send(CONVERSATION_PATTERNS.CREATE_CONVERSATION, {
      type,
      memberIds,
      createdBy,
      name,
      description,
      avatarMediaId,
    });
  }

  /**
   * Get conversation details, enriched with:
   * - presigned avatar URL (for GROUP/ANNOUNCEMENT)
   * - user profiles on participants (soft-fail)
   */
  async getConversation(conversationId: string, userId: string, variant: 'thumb' | 'original' = 'thumb') {
    const conversation = await this.proxy.send(CONVERSATION_PATTERNS.GET_CONVERSATION, {
      conversationId,
      userId,
    });
    if (!conversation) return conversation;

    // Avatar URL enrichment
    const avatarMap = conversation.avatarMediaId
      ? await this.enrichWithAvatarUrls([conversation], variant)
      : {};

    // Participant user-profile enrichment
    const participantIds: string[] = [
      ...new Set<string>(
        (conversation.participants ?? []).map((p: any) => p.userId).filter((id): id is string => !!id),
      ),
    ];
    const userInfoMap = await this.enrichWithUserInfo(participantIds);

    // Resolve presigned avatar URLs for all participant users in one batch
    const participantAvatarUrlMap = userInfoMap.size > 0
      ? await this.enrichParticipantsWithAvatarUrls(userInfoMap)
      : new Map<string, string>();

    // Strip stale avatarUrl that may be stored in the metadata JSONB column
    // from older code versions. avatarUrl is always resolved at gateway level.
    const { avatarUrl: _ignoredAvatarUrl, ...cleanMetadata } = conversation.metadata ?? {};

    const enrichedParticipants = (conversation.participants ?? []).map((p: any) => {
      const u = userInfoMap.get(p.userId);
      return {
        userId: p.userId,
        role: p.role,
        username: u?.username ?? null,
        displayName: u?.displayName || u?.username || null,
        avatarUrl: participantAvatarUrlMap.get(u?.avatarMediaId) ?? null,
      };
    });

    // For DIRECT conversations, name = the other participant's display name
    let resolvedName = conversation.name;
    if (conversation.type === 'direct') {
      const otherParticipant = enrichedParticipants.find((p: any) => p.userId !== userId);
      if (otherParticipant) {
        resolvedName = otherParticipant.displayName || otherParticipant.username || null;
      }
    }

    return {
      ...conversation,
      name: resolvedName,
      metadata: Object.keys(cleanMetadata).length ? cleanMetadata : undefined,
      avatarUrl: conversation.avatarMediaId
        ? (avatarMap[conversation.avatarMediaId] ?? null)
        : null,
      participants: enrichedParticipants,
    };
  }

  /**
   * Add members to conversation
   */
  async addMembers(conversationId: string, userIds: string[], addedBy: string) {
    return this.proxy.send(CONVERSATION_PATTERNS.ADD_MEMBERS, {
      conversationId,
      userIds,
      addedBy,
    });
  }

  /**
   * Get outbox health status
   */
  async getOutboxHealth() {
    return this.proxy.send(CONVERSATION_PATTERNS.GET_OUTBOX_HEALTH, {});
  }

  /**
   * Remove members from conversation
   */
  async removeMembers(
    conversationId: string,
    userIds: string[],
    removedBy: string,
  ) {
    return this.proxy.send(CONVERSATION_PATTERNS.REMOVE_MEMBERS, {
      conversationId,
      userIds,
      removedBy,
    });
  }

  /**
   * Get member IDs of conversation
   */
  async getMemberIds(conversationId: string) {
    return this.proxy.send(CONVERSATION_PATTERNS.GET_MEMBER_IDS, {
      conversationId,
    });
  }

  /**
   * Get members with roles + enriched user profiles.
   * Calls GET_MEMBERS_WITH_ROLES then batch-fetches user profiles in one round-trip.
   * Returns [{ userId, role, displayName, avatarUrl, ... }]
   */
  async getMembersWithProfiles(
    conversationId: string,
    avatarVariant: 'thumb' | 'original' = 'thumb',
  ) {
    const raw: any = await this.proxy.send(
      CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES,
      { conversationId },
    );

    const memberList: Array<{ userId: string; role: string }> = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.members)
        ? raw.members
        : [];

    if (!memberList.length) return [];

    const userIds = memberList.map((m) => m.userId);
    const profiles = await this.usersGateway.getUsersByIds(userIds, avatarVariant);
    const profileMap = new Map(profiles.map((p: any) => [p.id ?? p.keycloakId ?? p.userId, p]));

    return memberList.map((m) => {
      const profile = profileMap.get(m.userId) ?? {};
      return { ...profile, userId: m.userId, role: m.role };
    });
  }

  /**
   * Get unread count for user in conversation
   */
  async getUnreadCount(conversationId: string, userId: string) {
    return this.proxy.send(CONVERSATION_PATTERNS.GET_UNREAD_COUNT, {
      conversationId,
      userId,
    });
  }

  /**
   * Update last seen offset (for ALL conversation types)
   */
  async updateLastSeenOffset(
    conversationId: string,
    userId: string,
    offset: number,
  ) {
    return this.proxy.send(CONVERSATION_PATTERNS.UPDATE_LAST_SEEN_OFFSET, {
      conversationId,
      userId,
      offset,
    });
  }

  /**
   * Enriches a list of conversations with presigned avatar URLs.
   *
   * Strategy:
   * 1. Deduplicate avatarMediaIds (Set)
   * 2. Redis MGET for all keys in one round-trip
   * 3. Skip near-expired entries (< 60s remaining) — treat as cache miss
   * 4. Batch-fetch misses from Media Service in a single TCP call
   * 5. Cache each result with smart TTL = (expiresAt − now) − 5 min buffer
   *
   * @param variant 'thumb' (default) | 'original' — controls which URL is resolved.
   * Returns a map of { mediaId → presigned URL string }
   */
  private async enrichWithAvatarUrls(
    conversations: Array<{ avatarMediaId?: string | null }>,
    variant: 'thumb' | 'original' = 'thumb',
  ): Promise<Record<string, string>> {
    const uniqueIds = [
      ...new Set(
        conversations
          .map((c) => c.avatarMediaId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (!uniqueIds.length) return {};

    const now = Date.now();
    const ONE_MINUTE_MS = 60_000;
    const FIVE_MINUTES_MS = 300_000;

    // Cache key includes variant so thumb and original are cached separately
    const cacheKey = (id: string) =>
      variant === 'original'
        ? `${REDIS_KEYS.CACHE.AVATAR_URL(id)}:original`
        : REDIS_KEYS.CACHE.AVATAR_URL(id);

    // --- Redis MGET (single round-trip) ---
    const redisKeys = uniqueIds.map(cacheKey);
    const cachedValues = await this.redis.mget(...redisKeys).catch(() => []);

    const urlMap: Record<string, string> = {};
    const missIds: string[] = [];

    for (let i = 0; i < uniqueIds.length; i++) {
      const raw = cachedValues[i];
      if (raw) {
        try {
          const entry: { url: string; expiresAt: number } = JSON.parse(raw);
          if (entry.url && entry.expiresAt - now > ONE_MINUTE_MS) {
            urlMap[uniqueIds[i]] = entry.url;
            continue;
          }
        } catch {
          // parse error — treat as miss
        }
      }
      missIds.push(uniqueIds[i]);
    }

    if (!missIds.length) return urlMap;

    // --- Batch-fetch from Media Service ---
    try {
      const response = await this.mediaGateway.getAvatarsBatch(missIds, variant);
      const batchUrls: Record<string, { url: string; expiresAt: number }> =
        response?.urls ?? {};

      const pipeline = this.redis.pipeline();
      for (const [mediaId, entry] of Object.entries(batchUrls)) {
        if (!entry?.url) continue;
        urlMap[mediaId] = entry.url;

        // Cache for up to (expiresAt - now - FIVE_MINUTES_MS), but at least
        // 60 seconds if the URL is still within its validity window.
        // This handles PRESIGNED_GET_URL_EXPIRY=300s where subtracting the
        // 5-minute buffer would yield ttlMs=0 and skip caching entirely.
        const remainingMs = entry.expiresAt - now;
        const ttlMs =
          remainingMs > FIVE_MINUTES_MS
            ? remainingMs - FIVE_MINUTES_MS
            : remainingMs > ONE_MINUTE_MS
              ? remainingMs - ONE_MINUTE_MS
              : 0;
        if (ttlMs > 0) {
          pipeline.set(
            cacheKey(mediaId),
            JSON.stringify(entry),
            'PX',
            ttlMs,
          );
        }
      }
      await pipeline.exec().catch(() => {
        this.logger.warn('enrichWithAvatarUrls: Redis pipeline write failed');
      });
    } catch (err) {
      this.logger.warn(
        `enrichWithAvatarUrls: Media Service batch failed — ${(err as Error).message}`,
      );
    }

    return urlMap;
  }

  /**
   * Fetch user profiles by IDs from Users Service (soft-fail).
   * Returns a Map<userId, userProfile>.
   */
  private async enrichWithUserInfo(ids: string[]): Promise<Map<string, any>> {
    if (!ids.length) return new Map();
    try {
      const users = (await this.usersGateway.getUsersByIds(ids)) as any[];
      return new Map(
        (Array.isArray(users) ? users : []).map((u: any) => [u.id, u]),
      );
    } catch (err) {
      this.logger.warn(
        `enrichWithUserInfo: Users Service failed — ${(err as Error).message}`,
      );
      return new Map();
    }
  }

  /**
   * Enriches user profiles with presigned avatar URLs.
   *
   * Reuses the same Redis MGET + Media Service batch call strategy as
   * enrichWithAvatarUrls() — so a 1000-member conversation still results in
   * only 1 Redis MGET + at most 1 batch call to Media Service for cache misses.
   *
   * @returns Map<avatarMediaId, presignedUrl>
   */
  private async enrichParticipantsWithAvatarUrls(
    userInfoMap: Map<string, any>,
  ): Promise<Map<string, string>> {
    const avatarMediaIds = [
      ...new Set(
        [...userInfoMap.values()]
          .map((u: any) => u?.avatarMediaId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (!avatarMediaIds.length) return new Map();

    const urlRecord = await this.enrichWithAvatarUrls(
      avatarMediaIds.map((id) => ({ avatarMediaId: id })),
      'thumb',
    );

    return new Map(Object.entries(urlRecord));
  }
}

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  createLogger,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  ACLErrorCode,
  ERROR_CODES,
  REDIS_KEYS,
  ConversationType,
} from '@app/common';
import {
  ServiceRegistry,
  IConversationService,
  IFriendshipService,
  IUserService,
  SERVICE_NAMES,
  ConversationDto,
  MembershipDto,
} from '@app/service-contracts';
import { InteractionActionType } from '@app/common';
import { INTERACTION_VALIDATOR } from '@app/common';

/**
 * The validated context produced by `validateInteractionOrThrow`.
 * Downstream orchestrators use this to avoid re-fetching conversation/members.
 */
export interface InteractionContext {
  /** Full conversation object (L1-cached, never stale > 15 s) */
  conversation: ConversationDto;
  /** Member list resolved from L2 Redis or L3 TCP (cached 30 s) */
  members: MembershipDto[];
  /**
   * The OTHER member's userId for DIRECT conversations.
   * undefined for GROUP / ANNOUNCEMENT conversations.
   */
  receiverId?: string;
  /**
   * Relationship metadata for DIRECT conversations (friends / strangers / blocked).
   * undefined for GROUP / ANNOUNCEMENT conversations.
   */
  relationshipMetadata?: Record<string, any>;
}

/**
 * InteractionValidatorService
 *
 * Single source of truth for "can actorId perform actionType in conversationId?".
 *
 * Validation rules:
 *   1. Membership — actor must be in the conversation.
 *   2. DIRECT conversations — Redis MGET block check (both directions).
 *   3. GROUP/ANNOUNCEMENT + SEND/FORWARD — allowMemberMessage flag; members need
 *      OWNER or ADMIN role when the flag is false.
 *
 * Performance:
 *   – L0: Redis conversation metadata cache (5-min TTL, cross-restart durability)
 *   – L1: In-process conversation + members Map (15 s / 30 s TTL)
 *   – Singleflight: concurrent cache-miss requests coalesced into ONE TCP call
 *   – Redis MGET: 4 block/friends keys in a single round-trip
 *
 * This service is the only place that owns these caches. Orchestrators no longer
 * maintain their own duplicate Maps.
 */
@Injectable()
export class InteractionValidatorService implements OnModuleDestroy {
  private readonly logger = createLogger(InteractionValidatorService.name);

  // ── L1 in-process caches ──────────────────────────────────────────────────

  /** Conversation metadata: conversationId → { data, validUntil } */
  private readonly convCache = new Map<
    string,
    { data: ConversationDto; validUntil: number }
  >();
  private readonly convInflight = new Map<string, Promise<ConversationDto | null>>();

  /** Members list: conversationId → { data[], validUntil } */
  private readonly membersCache = new Map<
    string,
    { data: MembershipDto[]; validUntil: number }
  >();
  private readonly membersInflight = new Map<string, Promise<MembershipDto[]>>();

  /** Friendship status: sortedKey(A,B) → { status, validUntil } */
  private readonly friendshipCache = new Map<
    string,
    { status: any; validUntil: number }
  >();

  /** Receiver privacy: userId → { allowStrangerMessagesAndCalls, validUntil } */
  private readonly privacyCache = new Map<
    string,
    { allowStrangerMessagesAndCalls: boolean; validUntil: number }
  >();

  /** Singleflight for isMember() TCP fallback */
  private readonly membershipInflight = new Map<string, Promise<boolean>>();

  private readonly cacheCleanup: ReturnType<typeof setInterval>;

  constructor(
    private readonly registry: ServiceRegistry,
    @InjectRedis() private readonly redis: Redis,
  ) {
    // Periodic eviction of expired in-process cache entries (every 30 s)
    this.cacheCleanup = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.convCache.entries()) {
        if (now >= v.validUntil) this.convCache.delete(k);
      }
      for (const [k, v] of this.membersCache.entries()) {
        if (now >= v.validUntil) this.membersCache.delete(k);
      }
      for (const [k, v] of this.friendshipCache.entries()) {
        if (now >= v.validUntil) this.friendshipCache.delete(k);
      }
      for (const [k, v] of this.privacyCache.entries()) {
        if (now >= v.validUntil) this.privacyCache.delete(k);
      }
    }, 30_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cacheCleanup);
    this.convCache.clear();
    this.membersCache.clear();
    this.friendshipCache.clear();
    this.privacyCache.clear();
    this.membershipInflight.clear();
    this.membersInflight.clear();
    this.convInflight.clear();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Validate that `actorId` may perform `actionType` inside `conversationId`.
   *
   * @throws ForbiddenException  FORBIDDEN_NOT_MEMBER | FORBIDDEN_BLOCKED_USER | FORBIDDEN_MEMBER_MESSAGE_RESTRICTED
   * @throws NotFoundException   CONVERSATION_NOT_FOUND
   * @throws ServiceUnavailableException  CONVERSATION_SERVICE_UNAVAILABLE
   * @returns InteractionContext  — validated conversation, members, receiverId (DIRECT), and relationshipMetadata (DIRECT)
   */
  async validateInteractionOrThrow(
    actorId: string,
    conversationId: string,
    actionType: InteractionActionType,
  ): Promise<InteractionContext> {
    // ── Step 1: Fetch conversation + members in parallel (singleflighted + cached) ──
    const [conversation, members] = await Promise.all([
      this.getConversation(conversationId),
      this.getMembers(conversationId),
    ]);

    // ── Step 2: Membership check ──────────────────────────────────────────────
    await this.assertMembership(actorId, conversationId, members);

    // ── Step 3: Group policy — allowMemberMessage ─────────────────────────────
    if (
      conversation.type !== ConversationType.DIRECT &&
      (actionType === 'SEND' || actionType === 'FORWARD') &&
      conversation.allowMemberMessage === false
    ) {
      let senderMember = members.find((m) => m.userId === actorId);

      // The actor passed assertMembership (confirmed member) but is absent from the
      // cached members list — the SMEMBERS set is stale (e.g. member joined after
      // cache population).  Evict L1 and re-fetch authoritatively so we get the
      // correct role instead of silently defaulting to 'member'.
      if (!senderMember) {
        this.membersCache.delete(conversationId);
        const svc = this.registry.resolve<IConversationService>(SERVICE_NAMES.CONVERSATION);
        if (svc) {
          try {
            const fresh = await svc.getMembers(conversationId);
            if (fresh?.length) {
              this.membersCache.set(conversationId, {
                data: fresh,
                validUntil: Date.now() + 30_000,
              });
            }
            senderMember = fresh?.find((m: MembershipDto) => m.userId === actorId);
          } catch {
            // fall through — fail open: confirmed member, unknown role → allow
          }
        }
      }

      const role = (senderMember?.role ?? 'owner').toLowerCase(); // fail-open: unknown role → allow
      if (!['owner', 'admin'].includes(role)) {
        throw new ForbiddenException(ACLErrorCode.FORBIDDEN_MEMBER_MESSAGE_RESTRICTED, {
          conversationId,
          actorId,
          role,
        });
      }
    }

    // ── Step 4: DIRECT — block check + relationship metadata ─────────────────
    if (conversation.type === ConversationType.DIRECT) {
      const { receiverId, relationshipMetadata } =
        await this.resolveDirectContext(actorId, conversation, members);
      return { conversation, members, receiverId, relationshipMetadata };
    }

    return { conversation, members };
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  /**
   * Expose the conversation cache for orchestrators that need extra fields
   * (e.g. conversation.name, conversation.type) without a second fetch.
   */
  async getConversation(conversationId: string): Promise<ConversationDto> {
    // L1 in-process
    const cached = this.convCache.get(conversationId);
    if (cached && Date.now() < cached.validUntil) return cached.data;

    // Singleflight
    const pending = this.convInflight.get(conversationId);
    if (pending) {
      const result = await pending.catch((err) => {
        this.throwConvServiceError(err, conversationId);
      });
      if (!result) throw new NotFoundException('CONVERSATION_NOT_FOUND', { conversationId });
      return result;
    }

    const fetchPromise = this.fetchConversation(conversationId);
    this.convInflight.set(conversationId, fetchPromise);
    fetchPromise.finally(() => this.convInflight.delete(conversationId)).catch(() => {});

    try {
      const conversation = await fetchPromise;
      if (!conversation) throw new NotFoundException('CONVERSATION_NOT_FOUND', { conversationId });
      return conversation;
    } catch (err: any) {
      if (err?.status === 404 || err?.name === 'NotFoundException') throw err;
      throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE', { conversationId });
    }
  }

  /**
   * Expose the members cache so orchestrators can read receiverId / roles
   * without a second TCP round-trip.
   */
  async getMembers(conversationId: string): Promise<MembershipDto[]> {
    return this.withSingleflight(
      conversationId,
      this.membersCache,
      this.membersInflight,
      30_000,
      () => this.fetchMembers(conversationId),
      (data) => data.length > 0,
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async assertMembership(
    actorId: string,
    conversationId: string,
    members: MembershipDto[],
  ): Promise<void> {
    // Fast path: already in the cached list
    if (members.some((m) => m.userId === actorId)) return;

    // Slow path: singleflighted TCP check
    const conversationService = this.requireConversationService(conversationId, actorId);
    const key = `${actorId}:${conversationId}`;

    const pending = this.membershipInflight.get(key);
    let isMember: boolean;

    if (pending) {
      isMember = await pending.catch(() => {
        throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE', {
          conversationId,
          userId: actorId,
        });
      });
    } else {
      const p = conversationService.isMember(actorId, conversationId);
      this.membershipInflight.set(key, p);
      p.finally(() => this.membershipInflight.delete(key)).catch(() => {});
      isMember = await p.catch(() => {
        throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE', {
          conversationId,
          userId: actorId,
        });
      });
    }

    if (!isMember) {
      throw new ForbiddenException(ACLErrorCode.FORBIDDEN_NOT_MEMBER, {
        conversationId,
        userId: actorId,
      });
    }
  }

  private async resolveDirectContext(
    actorId: string,
    conversation: ConversationDto,
    members: MembershipDto[],
  ): Promise<{ receiverId: string; relationshipMetadata: Record<string, any> }> {
    // ── Resolve receiverId from in-memory members (0 TCP) ──────────────────
    let receiver = members.find((m) => m.userId !== actorId);

    if (!receiver?.userId) {
      // Stale SMEMBERS cache — evict L1 and re-fetch authoritatively
      this.membersCache.delete(conversation.id);
      const svc = this.registry.resolve<IConversationService>(SERVICE_NAMES.CONVERSATION);
      if (svc) {
        try {
          const fresh = await svc.getMembers(conversation.id);
          if (fresh?.length >= 2) {
            const membersKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversation.id);
            this.redis
              .sadd(membersKey, ...fresh.map((m: MembershipDto) => m.userId))
              .catch(() => {});
            this.membersCache.set(conversation.id, {
              data: fresh,
              validUntil: Date.now() + 30_000,
            });
          }
          receiver = fresh?.find((m: MembershipDto) => m.userId !== actorId);
        } catch {
          // fall through to 503 below
        }
      }
    }

    if (!receiver?.userId) {
      throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE', {
        reason: 'RECEIVER_NOT_FOUND_IN_DIRECT_CONVERSATION',
        conversationId: conversation.id,
        actorId,
      });
    }

    const receiverId = receiver.userId;

    // ── Block check via Redis MGET ─────────────────────────────────────────
    const [blocked, blockedBy, friends, proof] = await this.mgetRelationship(
      actorId,
      receiverId,
      200,
    );

    if (blocked || blockedBy) {
      throw new ForbiddenException('FORBIDDEN_BLOCKED_USER', {
        actorId,
        receiverId,
        isBlocked: !!blocked,
        isBlockedBy: !!blockedBy,
      });
    }

    const authoritativeBlock = await this.resolveAuthoritativeBlockStatus(
      actorId,
      receiverId,
    );
    if (authoritativeBlock.isBlocked || authoritativeBlock.isBlockedBy) {
      throw new ForbiddenException('FORBIDDEN_BLOCKED_USER', {
        actorId,
        receiverId,
        isBlocked: authoritativeBlock.isBlocked,
        isBlockedBy: authoritativeBlock.isBlockedBy,
      });
    }

    await this.enforceStrangerPrivacy(actorId, receiverId, friends, proof);

    // ── Relationship metadata (for Kafka event enrichment) ────────────────
    const relationshipMetadata = this.buildRelationshipMetadata(
      actorId,
      receiverId,
      conversation,
      friends,
      proof,
    );

    return { receiverId, relationshipMetadata };
  }

  /**
   * Build relationship metadata from cached signals.
   * Never blocks on TCP — fires background warm on cache miss.
   */
  private buildRelationshipMetadata(
    actorId: string,
    receiverId: string,
    conversation: ConversationDto,
    cachedFriends: string | null,
    cachedProof: string | null,
  ): Record<string, any> {
    // Friends confirmed via Redis or proof token
    if ((cachedFriends && parseInt(cachedFriends, 10) > 0) || cachedProof) {
      return {
        receiverId,
        messageType: 'friends',
        relationshipType: 'friends',
        friendshipStatus: 'FRIEND',
      };
    }

    // In-process friendship cache
    const cacheKey = [actorId, receiverId].sort().join(':');
    const cached = this.friendshipCache.get(cacheKey);
    if (cached && Date.now() < cached.validUntil) {
      const fs = cached.status;
      // Block status already checked above — but double-check in-process cache
      if (fs.isBlocked || fs.isBlockedBy) {
        throw new ForbiddenException('FORBIDDEN_BLOCKED_USER', {
          actorId,
          receiverId,
          isBlocked: fs.isBlocked,
          isBlockedBy: fs.isBlockedBy,
        });
      }
      if (fs.isFriend) {
        return { receiverId, messageType: 'friends', relationshipType: 'friends', friendshipStatus: fs.status };
      }
      const conv = conversation as any;
      const hasHistory = Number(conv?.maxOffset || 0) > 0 || !!conv?.lastMessage;
      return {
        receiverId,
        messageType: hasHistory ? 'strangers_replied' : 'strangers_first',
        relationshipType: 'strangers',
        friendshipStatus: fs.status,
      };
    }

    // No cache — warm in background, accept with defaults
    this.warmFriendshipCache(actorId, receiverId);
    return { receiverId, messageType: 'default', relationshipType: 'unknown' };
  }

  private warmFriendshipCache(actorId: string, receiverId: string): void {
    const cacheKey = [actorId, receiverId].sort().join(':');
    if (this.friendshipCache.has(cacheKey)) return;

    const svc = this.registry.resolve<IFriendshipService>(SERVICE_NAMES.FRIENDSHIP);
    if (!svc) return;

    svc
      .getFriendshipStatus(actorId, receiverId)
      .then((status) => {
        this.friendshipCache.set(cacheKey, { status, validUntil: Date.now() + 30_000 });
      })
      .catch((err) => {
        this.logger.warn(`Friendship cache warm failed: ${String(err?.message ?? err)}`);
      });
  }

  private async enforceStrangerPrivacy(
    actorId: string,
    receiverId: string,
    cachedFriends: string | null,
    cachedProof: string | null,
  ): Promise<void> {
    const privacy = await this.getReceiverPrivacy(receiverId);
    if (privacy.allowStrangerMessagesAndCalls !== false) return;

    const isFriend = await this.resolveFriendshipForPrivacy(
      actorId,
      receiverId,
      cachedFriends,
      cachedProof,
    );
    if (isFriend) return;

    throw new ForbiddenException(ERROR_CODES.FORBIDDEN_STRANGER_INTERACTION, {
      actorId,
      receiverId,
      requiredRelationship: 'FRIEND',
    });
  }

  private async resolveFriendshipForPrivacy(
    actorId: string,
    receiverId: string,
    cachedFriends: string | null,
    cachedProof: string | null,
  ): Promise<boolean> {
    if ((cachedFriends && parseInt(cachedFriends, 10) > 0) || cachedProof) {
      return true;
    }

    const cacheKey = [actorId, receiverId].sort().join(':');
    const cached = this.friendshipCache.get(cacheKey);
    if (cached && Date.now() < cached.validUntil) {
      if (cached.status?.isBlocked || cached.status?.isBlockedBy) {
        throw new ForbiddenException('FORBIDDEN_BLOCKED_USER', {
          actorId,
          receiverId,
          isBlocked: cached.status.isBlocked,
          isBlockedBy: cached.status.isBlockedBy,
        });
      }
      return cached.status?.isFriend === true;
    }

    const svc = this.registry.resolve<IFriendshipService>(SERVICE_NAMES.FRIENDSHIP);
    if (!svc) {
      throw new ServiceUnavailableException('FRIENDSHIP_SERVICE_UNAVAILABLE', {
        actorId,
        receiverId,
      });
    }

    try {
      const status = await svc.getFriendshipStatus(actorId, receiverId);
      this.friendshipCache.set(cacheKey, { status, validUntil: Date.now() + 30_000 });
      if (status.isBlocked || status.isBlockedBy) {
        throw new ForbiddenException('FORBIDDEN_BLOCKED_USER', {
          actorId,
          receiverId,
          isBlocked: status.isBlocked,
          isBlockedBy: status.isBlockedBy,
        });
      }
      return status.isFriend === true;
    } catch (err: any) {
      if (err?.status === 403 || err?.name === 'ForbiddenException') throw err;
      throw new ServiceUnavailableException('FRIENDSHIP_SERVICE_UNAVAILABLE', {
        actorId,
        receiverId,
      });
    }
  }

  private async getReceiverPrivacy(
    receiverId: string,
  ): Promise<{ allowStrangerMessagesAndCalls: boolean }> {
    const cached = this.privacyCache.get(receiverId);
    if (cached && Date.now() < cached.validUntil) {
      return {
        allowStrangerMessagesAndCalls: cached.allowStrangerMessagesAndCalls,
      };
    }

    const svc = this.registry.resolve<IUserService>(SERVICE_NAMES.USERS);
    if (!svc) {
      throw new ServiceUnavailableException('USERS_SERVICE_UNAVAILABLE', {
        receiverId,
      });
    }

    try {
      const user = await svc.getUser(receiverId);
      if (!user) {
        throw new ServiceUnavailableException('USERS_SERVICE_UNAVAILABLE', {
          receiverId,
          reason: 'RECEIVER_NOT_FOUND',
        });
      }

      const allowStrangerMessagesAndCalls =
        user.settings?.privacy?.allowStrangerMessagesAndCalls !== false;
      this.privacyCache.set(receiverId, {
        allowStrangerMessagesAndCalls,
        validUntil: Date.now() + 30_000,
      });
      return { allowStrangerMessagesAndCalls };
    } catch (err: any) {
      if (err?.status === 503 || err?.name === 'ServiceUnavailableException') {
        throw err;
      }
      throw new ServiceUnavailableException('USERS_SERVICE_UNAVAILABLE', {
        receiverId,
      });
    }
  }

  private async resolveAuthoritativeBlockStatus(
    actorId: string,
    receiverId: string,
  ): Promise<{ isBlocked: boolean; isBlockedBy: boolean }> {
    const svc = this.registry.resolve<IFriendshipService>(SERVICE_NAMES.FRIENDSHIP);
    if (!svc) {
      throw new ServiceUnavailableException('FRIENDSHIP_SERVICE_UNAVAILABLE', {
        actorId,
        receiverId,
      });
    }

    try {
      const [isBlockedBy, isBlocked] = await Promise.all([
        svc.isBlockedBy(actorId, receiverId),
        svc.isBlockedBy(receiverId, actorId),
      ]);
      return { isBlocked, isBlockedBy };
    } catch (err: any) {
      if (
        err?.status === 503 ||
        err?.name === 'ServiceUnavailableException' ||
        (err?.message ?? '').includes('unavailable')
      ) {
        throw new ServiceUnavailableException('FRIENDSHIP_SERVICE_UNAVAILABLE', {
          actorId,
          receiverId,
        });
      }
      throw err;
    }
  }

  /**
   * Read 4 relationship Redis keys in a single MGET with a micro-timeout.
   * Returns all-null on timeout/error so the caller falls through gracefully.
   */
  async mgetRelationship(
    actorId: string,
    receiverId: string,
    timeoutMs = 200,
  ): Promise<[string | null, string | null, string | null, string | null]> {
    const keys = [
      REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(actorId, receiverId),
      REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(receiverId, actorId),
      REDIS_KEYS.CHAT.FRIENDSHIP_FRIENDS(actorId, receiverId),
      REDIS_KEYS.CHAT.FRIENDSHIP_PROOF(actorId, receiverId),
    ] as const;

    const fallback = [null, null, null, null] as [null, null, null, null];
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        this.redis.mget(...keys),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('REDIS_CACHE_TIMEOUT')), timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      return (result ?? fallback) as [
        string | null,
        string | null,
        string | null,
        string | null,
      ];
    } catch (err: unknown) {
      clearTimeout(timer);
      const isTimeout = err instanceof Error && err.message === 'REDIS_CACHE_TIMEOUT';
      this.logger.warn(
        isTimeout
          ? `[Redis] mget timed out (>${timeoutMs}ms) — falling back`
          : `[Redis] mget failed — falling back: ${String(err)}`,
      );
      return fallback;
    }
  }

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  private async fetchConversation(
    conversationId: string,
  ): Promise<ConversationDto | null> {
    // L0: Redis cache (30-min TTL) — survives pod restarts
    try {
      const raw = await this.redis.get(this.convRedisKey(conversationId));
      if (raw) {
        const conv = JSON.parse(raw) as ConversationDto;
        this.convCache.set(conversationId, { data: conv, validUntil: Date.now() + 15_000 });
        return conv;
      }
    } catch {
      // Redis miss — fall through to TCP
    }

    const svc = this.registry.resolve<IConversationService>(SERVICE_NAMES.CONVERSATION);
    if (!svc) throw new Error('CONVERSATION_SERVICE_UNAVAILABLE');

    const conversation = await svc.getConversation(conversationId);
    if (conversation) {
      this.convCache.set(conversationId, { data: conversation, validUntil: Date.now() + 15_000 });
      this.redis
        .setex(this.convRedisKey(conversationId), 1800, JSON.stringify(conversation))
        .catch(() => {});
    }
    return conversation;
  }

  private async fetchMembers(conversationId: string): Promise<MembershipDto[]> {
    // L2: Redis SMEMBERS
    const membersKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
    let memberIds: string[] = [];
    try { memberIds = await this.redis.smembers(membersKey); } catch { /* fall through */ }

    if (memberIds.length >= 2) {
      const roleKeys = memberIds.map((uid) => `${membersKey}:${uid}:role`);
      let roles: (string | null)[] = [];
      try { roles = await this.redis.mget(...roleKeys); }
      catch { roles = new Array(memberIds.length).fill(null); }

      // Only trust the Redis cache if ALL role keys are present. A null role would
      // silently downgrade an OWNER or ADMIN to 'MEMBER', causing false
      // FORBIDDEN_MEMBER_MESSAGE_RESTRICTED errors when allowMemberMessage=false.
      // Fall through to the authoritative TCP fetch whenever any role is missing.
      if (roles.every((r) => r !== null)) {
        return memberIds.map((userId, i): MembershipDto => ({
          userId,
          conversationId,
          role: roles[i]!,
          joinedAt: new Date(0),
        }));
      }

      this.logger.debug(
        `fetchMembers: ${roles.filter((r) => r === null).length}/${memberIds.length} role key(s) missing in Redis for conversation ${conversationId} — falling through to TCP`,
      );
    }

    // L3: TCP fallback (authoritative, includes correct role data)
    const svc = this.registry.resolve<IConversationService>(SERVICE_NAMES.CONVERSATION);
    if (!svc) throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE');
    return (await svc.getMembers(conversationId)) || [];
  }

  private convRedisKey(conversationId: string): string {
    return `chat:conv:meta:${conversationId}`;
  }

  private requireConversationService(
    conversationId: string,
    userId: string,
  ): IConversationService {
    const svc = this.registry.resolve<IConversationService>(SERVICE_NAMES.CONVERSATION);
    if (!svc) {
      throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE', {
        conversationId,
        userId,
      });
    }
    return svc;
  }

  private throwConvServiceError(err: any, conversationId: string): never {
    if (
      err?.status === 503 ||
      err?.name === 'ServiceUnavailableException' ||
      (err?.message ?? '').includes('UNAVAILABLE') ||
      (err?.message ?? '').includes('ECONNREFUSED')
    ) {
      throw new ServiceUnavailableException('CONVERSATION_SERVICE_UNAVAILABLE', { conversationId });
    }
    throw err;
  }

  /**
   * Generic L1 in-process TTL cache + singleflight pattern.
   */
  private async withSingleflight<T>(
    key: string,
    cacheMap: Map<string, { data: T; validUntil: number }>,
    inflightMap: Map<string, Promise<T>>,
    ttlMs: number,
    fetcher: () => Promise<T>,
    shouldCache?: (data: T) => boolean,
  ): Promise<T> {
    const cached = cacheMap.get(key);
    if (cached && Date.now() < cached.validUntil) return cached.data;

    const pending = inflightMap.get(key);
    if (pending) return pending;

    const p = fetcher().then((data) => {
      if (!shouldCache || shouldCache(data)) {
        cacheMap.set(key, { data, validUntil: Date.now() + ttlMs });
      }
      return data;
    });

    inflightMap.set(key, p);
    p.finally(() => inflightMap.delete(key)).catch(() => {});
    return p;
  }
}

/**
 * Re-export the injection token so services that provide this validator
 * can reference it from the same package.
 */
export { INTERACTION_VALIDATOR } from '@app/common';

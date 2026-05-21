import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  createLogger,
  ERROR_CODES,
  ERROR_MESSAGES,
  FRIENDSHIP_PATTERNS,
  Permission,
  REDIS_KEYS,
  SERVICES,
  USERS_PATTERNS,
} from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  CallConversationContext,
  CallMembershipResult,
  CallMembershipValidator,
} from '../validators/call-membership.validator';

// Inline permission map — any conversation member may start or join a call.
const CALL_PERMISSIONS: Record<string, Set<string>> = {
  OWNER: new Set([Permission.CALL_START, Permission.CALL_JOIN]),
  ADMIN: new Set([Permission.CALL_START, Permission.CALL_JOIN]),
  MEMBER: new Set([Permission.CALL_START, Permission.CALL_JOIN]),
};

export interface CallAccessContext {
  membership: CallMembershipResult;
  conversation: CallConversationContext;
  conversationType: string;
}

@Injectable()
export class CallAccessService {
  private readonly logger = createLogger(CallAccessService.name);
  private readonly userStatusCacheTtlMs = 30_000;
  private readonly accountStatusCache = new Map<
    string,
    { isActive: boolean; expiresAt: number }
  >();

  constructor(
    private readonly membershipValidator: CallMembershipValidator,
    @Inject(SERVICES.USERS) private readonly usersClient: ClientProxy,
    @Inject(SERVICES.FRIENDSHIP) private readonly friendshipClient: ClientProxy,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async ensureConversationAccess(
    userId: string,
    conversationId: string,
    permission: Permission,
    calleeIds?: string[],
  ): Promise<CallAccessContext> {
    await this.ensureUserAccountIsActive(userId);

    const membership = await this.membershipValidator.validateMembership(
      userId,
      conversationId,
    );
    if (!membership.isMember) {
      this.throwRpc(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_NOT_MEMBER);
    }

    const conversation = await this.getConversationOrThrow(conversationId);
    const conversationType = this.resolveConversationType(conversation);
    this.ensureConversationPermission(membership.role, permission);

    // Block check for DIRECT calls: prevent blocked users from initiating calls.
    // Uses the same Redis MGET keys as InteractionValidatorService for consistency.
    if (conversationType === 'direct' && calleeIds && calleeIds.length > 0) {
      await this.ensureNotBlocked(userId, calleeIds);
      await this.ensureCalleesAllowStrangerCalls(userId, calleeIds);
    }

    return { membership, conversation, conversationType };
  }

  async getConversationOrThrow(
    conversationId: string,
  ): Promise<CallConversationContext> {
    const conversation =
      await this.membershipValidator.getConversationContext(conversationId);
    if (!conversation) {
      this.throwRpc(HttpStatus.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    return conversation;
  }

  resolveConversationType(conversation: CallConversationContext): string {
    const baseType =
      typeof conversation.type === 'string'
        ? conversation.type.toLowerCase()
        : '';
    if (baseType) return baseType;

    const metadata = conversation.metadata || {};
    const kind =
      typeof metadata.kind === 'string' ? metadata.kind.toLowerCase() : '';
    return kind || 'direct';
  }

  throwRpc(statusCode: number, code: string): never {
    const message = ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code;
    throw new RpcException({ statusCode, message, errorCode: code });
  }

  /**
   * Block check for DIRECT calls via Redis MGET.
   * Checks both directions: caller→callee blocked AND callee→caller blocked.
   * On Redis timeout/error the check is skipped (soft dependency) to avoid
   * disrupting calls during a Redis failover.
   */
  private async ensureNotBlocked(callerId: string, calleeIds: string[]): Promise<void> {
    const keys = calleeIds.flatMap((calleeId) => [
      REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(callerId, calleeId),
      REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(calleeId, callerId),
    ]);

    let results: (string | null)[];
    try {
      results = await Promise.race([
        this.redis.mget(...keys),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 200),
        ),
      ]);
    } catch {
      this.logger.warn('Block check Redis timeout — allowing call by default');
      return;
    }

    // results: [caller→callee0, callee0→caller, caller→callee1, callee1→caller, ...]
    for (let i = 0; i < calleeIds.length; i++) {
      const isBlockedByCaller = !!results[i * 2];
      const isBlockedByCallee = !!results[i * 2 + 1];
      if (isBlockedByCaller || isBlockedByCallee) {
        this.throwRpc(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_BLOCKED_USER);
      }
    }
  }

  private async ensureCalleesAllowStrangerCalls(
    callerId: string,
    calleeIds: string[],
  ): Promise<void> {
    const uniqueCalleeIds = [...new Set(calleeIds)].filter(
      (id) => id !== callerId,
    );

    await Promise.all(
      uniqueCalleeIds.map(async (calleeId) => {
        const allowStrangers = await this.getAllowStrangerCalls(calleeId);
        if (allowStrangers) return;

        if (!(await this.areFriendsForPrivacy(callerId, calleeId))) {
          this.throwRpc(
            HttpStatus.FORBIDDEN,
            ERROR_CODES.FORBIDDEN_STRANGER_INTERACTION,
          );
        }
      }),
    );
  }

  private async areFriendsForPrivacy(
    callerId: string,
    calleeId: string,
  ): Promise<boolean> {
    const cacheKeys = [
      REDIS_KEYS.CHAT.FRIENDSHIP_FRIENDS(callerId, calleeId),
      REDIS_KEYS.CHAT.FRIENDSHIP_PROOF(callerId, calleeId),
    ];

    try {
      const [friends, proof] = await Promise.race([
        this.redis.mget(...cacheKeys),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 200),
        ),
      ]);
      if ((friends && parseInt(friends, 10) > 0) || proof) return true;
    } catch {
      this.logger.warn('Friendship Redis check timeout — falling back to TCP');
    }

    try {
      const result = await firstValueFrom(
        this.friendshipClient
          .send(FRIENDSHIP_PATTERNS.GET_FRIEND_STATUS, {
            userId: callerId,
            targetUserId: calleeId,
          })
          .pipe(timeout(3_000)),
      );
      const payload =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data?: any }).data
          : result;

      if (payload?.isBlocked || payload?.isBlockedBy) {
        this.throwRpc(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_BLOCKED_USER);
      }
      return payload?.isFriend === true;
    } catch (err: any) {
      if (err instanceof RpcException) throw err;
      this.logger.warn(
        `Friendship privacy check failed for ${callerId}->${calleeId}: ${err?.message ?? err}`,
      );
      this.throwRpc(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      );
    }
  }

  private async getAllowStrangerCalls(calleeId: string): Promise<boolean> {
    try {
      const result = await firstValueFrom(
        this.usersClient
          .send(USERS_PATTERNS.GET_USER, { id: calleeId })
          .pipe(timeout(3_000)),
      );
      const payload =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data?: any }).data
          : result;

      // Missing setting defaults to true to preserve legacy behaviour.
      return payload?.settings?.privacy?.allowStrangerMessagesAndCalls !== false;
    } catch (err: any) {
      if (err instanceof RpcException) throw err;
      this.logger.warn(
        `User privacy lookup failed for ${calleeId}: ${err?.message ?? err}`,
      );
      this.throwRpc(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      );
    }
  }

  /**
   * Soft privacy check for system-generated messages in DIRECT conversations.
   * Returns true if the caller is allowed to interact with the callee
   * (either callee allows strangers OR they are friends).
   * Always returns true on service errors (fail-open: don't suppress messages
   * when upstream services are unavailable).
   */
  async isDirectInteractionAllowed(
    callerId: string,
    calleeId: string,
  ): Promise<boolean> {
    try {
      const allowStrangers = await this.getAllowStrangerCalls(calleeId);
      if (allowStrangers) return true;
      return await this.areFriendsForPrivacy(callerId, calleeId);
    } catch {
      // Fail-open: don't suppress system messages when services are unavailable.
      return true;
    }
  }

  private ensureConversationPermission(
    role: string | undefined,
    permission: Permission,
  ): void {
    const normalizedRole = (role ?? '').toUpperCase();
    const allowed = CALL_PERMISSIONS[normalizedRole]?.has(permission) ?? false;
    if (!allowed) {
      this.logger.warn(
        `Permission denied for role=${normalizedRole} on ${permission}`,
      );
      this.throwRpc(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_ROLE_REQUIRED);
    }
  }

  private async ensureUserAccountIsActive(userId: string): Promise<void> {
    const cached = this.accountStatusCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.isActive !== false) return;
      this.throwRpc(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_ACCOUNT_BANNED);
    }

    try {
      const result = await firstValueFrom(
        this.usersClient
          .send(USERS_PATTERNS.GET_USER, { id: userId })
          .pipe(timeout(3_000)),
      );

      const payload =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data?: any }).data
          : result;

      const isActive = payload?.isActive !== false;

      this.accountStatusCache.set(userId, {
        isActive,
        expiresAt: Date.now() + this.userStatusCacheTtlMs,
      });

      if (!isActive) {
        this.throwRpc(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.FORBIDDEN_ACCOUNT_BANNED,
        );
      }
    } catch (err: any) {
      if (err instanceof RpcException) throw err;
      if (err instanceof TimeoutError) {
        this.logger.warn(
          `User status check timeout for ${userId} — allowing by default`,
        );
        return;
      }
      this.logger.warn(
        `User status check failed for ${userId}: ${err.message} — allowing by default`,
      );
    }
  }
}
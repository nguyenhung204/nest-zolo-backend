import { Injectable } from '@nestjs/common';
import {
  createLogger,
  ForbiddenException,
  BadRequestException,
  ACLErrorCode,
  Permission,
} from '@app/common';
import {
  ServiceRegistry,
  IConversationService,
  SERVICE_NAMES,
  UserDto,
  ConversationDto,
  MediaStatus,
} from '@app/service-contracts';
import { MembershipValidatorService } from '../validators/membership-validator.service';
import { UserValidatorService } from '../validators/user-validator.service';
import {
  AclRuleChainFactory,
  AclContext,
  AclRuleChain,
} from '../acl';
import { PreCheckMediaDto } from '../dto/pre-check-media.dto';

export interface PreCheckMediaResult {
  approved: boolean;
  conversationId: string;
  userId: string;
  timestamp: string;
  error?: { code: string; message: string; details?: any };
}

/**
 * Media Pre-check Orchestrator
 *
 * Single Responsibility: Validate media upload permissions BEFORE the file
 * is uploaded (Phase 1 of the two-phase commit pattern).
 *
 * Checks:
 * 1. User exists and account is ACTIVE
 * 2. Conversation exists
 * 3. Conversation membership
 * 4. MSG.SEND_MEDIA permission via ACL chain
 *
 * Execution Flow:
 * 1. Validate user (UserValidatorService)
 * 2. Fetch conversation (ServiceRegistry → ConversationService)
 * 3. Validate membership + role (MembershipValidatorService)
 * 4. Execute ACL chain for MSG.SEND_MEDIA with a synthetic media context
 *    (uses actual file metadata: mimeType, fileSize, classification defaults)
 * 5. Return approval token if all checks pass
 *
 * No file upload occurs at this stage.
 */
@Injectable()
export class MediaPreCheckOrchestrator {
  private readonly logger = createLogger(MediaPreCheckOrchestrator.name);
  private readonly aclChainMedia: AclRuleChain;

  /**
   * In-process conversation cache (30 s TTL).
   * Eliminates redundant TCP calls when N files are uploaded simultaneously
   * for the same conversation — the first request populates the cache and all
   * subsequent pre-checks in the same 30 s window reuse it.
   */
  private readonly convCache = new Map<
    string,
    { data: ConversationDto; validUntil: number }
  >();
  private readonly CONV_CACHE_TTL_MS = 30_000;

  /**
   * Singleflight map: when multiple pre-checks for the same conversationId
   * all miss the in-process cache simultaneously, exactly ONE TCP call is
   * sent to conversation-service; all other callers await that same Promise.
   */
  private readonly convInflight = new Map<string, Promise<ConversationDto>>();

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly membershipValidator: MembershipValidatorService,
    private readonly userValidator: UserValidatorService,
    private readonly aclFactory: AclRuleChainFactory,
  ) {
    this.aclChainMedia = this.aclFactory.createForMediaOperations();
    this.logger.log(
      'MediaPreCheckOrchestrator initialized with media ACL chain',
    );
  }

  async execute(dto: PreCheckMediaDto): Promise<PreCheckMediaResult> {
    this.logger.log(
      `Pre-checking media upload for conversation ${dto.conversationId} by ${dto.senderId}`,
    );

    try {
      // Step 1: Validate user
      const userValidation = await this.userValidator.validateUser(
        dto.senderId,
      );
      if (!userValidation.isValid) {
        throw new ForbiddenException(
          userValidation.reason || 'USER_VALIDATION_FAILED',
          {
            userId: dto.senderId,
            reason: userValidation.reason,
          },
        );
      }
      const user = userValidation.user as UserDto;

      // Step 2: Fetch conversation
      const conversation = await this.getConversation(dto.conversationId);

      // Step 3: Validate membership + role
      const membershipResult =
        await this.membershipValidator.validateMembership(
          dto.senderId,
          dto.conversationId,
        );
      if (!membershipResult.isMember) {
        throw new ForbiddenException(ACLErrorCode.FORBIDDEN_NOT_MEMBER, {
          conversationId: dto.conversationId,
          userId: dto.senderId,
        });
      }
      // Step 4: Execute ACL chain with synthetic media context
      await this.executeAclValidation({ user, conversation, dto });

      this.logger.log(`Media upload pre-check approved for ${dto.senderId}`);
      return {
        approved: true,
        conversationId: dto.conversationId,
        userId: dto.senderId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Media pre-check failed:`, error);
      const r = error.response || {};
      // Preserve the original HTTP status so that downstream errors (e.g. 503
      // ServiceUnavailableException) are not silently downgraded to 400.
      const originalStatus = error.status ?? error.statusCode ?? r.statusCode;
      let code: string;
      if (originalStatus === 503) {
        code = 'CONVERSATION_SERVICE_UNAVAILABLE';
      } else {
        code = r.errorCode || r.message || error.name || 'MEDIA_PRECHECK_FAILED';
      }
      return {
        approved: false,
        conversationId: dto.conversationId,
        userId: dto.senderId,
        timestamp: new Date().toISOString(),
        error: {
          code,
          message: r.message || error.message || 'Media pre-check failed',
          details: r.details || {},
        },
      };
    }
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  /**
   * Fetch conversation with in-process cache + singleflight.
   *
   * Cache TTL: 30 s — conversation metadata (type, settings) changes rarely.
   * Singleflight: when N simultaneous pre-checks all miss the cache, only ONE
   * TCP call goes to conversation-service; the rest await the same Promise.
   * This prevents the thundering-herd that trips the circuit breaker when a
   * user sends 20 files at once (each file is a separate pre-check request).
   */
  private async getConversation(
    conversationId: string,
  ): Promise<ConversationDto> {
    // L1: in-process TTL cache
    const cached = this.convCache.get(conversationId);
    if (cached && Date.now() < cached.validUntil) {
      return cached.data;
    }

    // Singleflight: coalesce concurrent cache-misses into a single TCP call
    const pending = this.convInflight.get(conversationId);
    if (pending) return pending;

    const fetchPromise = this.fetchConversationFromService(conversationId);
    this.convInflight.set(conversationId, fetchPromise);
    fetchPromise.finally(() => this.convInflight.delete(conversationId));
    return fetchPromise;
  }

  private async fetchConversationFromService(
    conversationId: string,
  ): Promise<ConversationDto> {
    const conversationService = this.registry.resolve<IConversationService>(
      SERVICE_NAMES.CONVERSATION,
    );
    if (!conversationService) {
      throw new Error('CONVERSATION_SERVICE_UNAVAILABLE');
    }
    const conversation =
      await conversationService.getConversation(conversationId);
    if (!conversation) {
      throw new BadRequestException('CONVERSATION_NOT_FOUND', {
        conversationId,
      });
    }
    // Populate in-process cache on successful fetch
    this.convCache.set(conversationId, {
      data: conversation,
      validUntil: Date.now() + this.CONV_CACHE_TTL_MS,
    });
    return conversation;
  }

  private async executeAclValidation(params: {
    user: UserDto;
    conversation: ConversationDto;
    dto: PreCheckMediaDto;
  }): Promise<void> {
    const { user, conversation, dto } = params;

    const aclContext: AclContext = {
      actor: {
        userId: user.id,
        isActive: user.isActive,
        isMember: true,
      },
      conversation: {
        id: conversation.id,
      },
      // Synthetic media context with safe defaults for pre-check
      media: {
        id: `precheck-${Date.now()}`,
        status: MediaStatus.UPLOADED,
        sizeBytes: dto.fileSize,
        mimeType: dto.mimeType,
      },
      nowMs: Date.now(),
    };

    const result = await this.aclChainMedia.execute(
      aclContext,
      Permission.MSG_SEND_MEDIA,
    );

    if (!result.allowed) {
      this.logger.warn(
        `ACL denied MSG.SEND_MEDIA (precheck): ${result.errorCode} for user ${user.id}`,
      );
      throw new ForbiddenException(result.errorCode || 'FORBIDDEN', {
        reason: result.reason,
        failedRule: result.failedRule,
      });
    }
  }
}

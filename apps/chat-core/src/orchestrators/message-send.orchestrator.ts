import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  createLogger,
  ConversationType,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  REDIS_KEYS,
} from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import {
  IFriendshipService,
  IUserService,
  SERVICE_NAMES,
  ServiceRegistry,
} from '@app/service-contracts';
import { MessageRateLimiterService } from '../validators/rate-limiter.service';
import { InteractionValidatorService } from '../validators/interaction-validator.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Send message DTO
 */
export interface AttachmentRef {
  mediaId: string;
  type?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Client-generated poster URL for video attachments (captured by FE before upload). */
  thumbUrl?: string;
}

export interface SendMessageDto {
  conversationId: string;
  senderId: string;
  /** Display name from JWT — forwarded to Kafka for notification formatting */
  senderName?: string;
  content: string;
  type: string;
  replyToMessageId?: string;
  metadata?: {
    mediaId?: string;
    replyToId?: string;
    mentions?: string[];
    mentionAll?: boolean;
    [key: string]: any;
  };
  mentions?: string[];
  clientMessageId?: string;
  attachments?: AttachmentRef[];
}

/**
 * Send message result
 */
export interface SendMessageResult {
  success: boolean;
  messageId: string;
  conversationId: string;
  metadata?: {
    messageType?: string;
    relationshipType?: string;
    [key: string]: any;
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

/**
 * Message Send Orchestrator
 *
 * Single Responsibility: Orchestrate rate-limiting, content validation, and
 * Kafka/Redis outbox publishing for the send-message flow.
 *
 * ALL access-control logic (membership, block check, allowMemberMessage) is
 * delegated to InteractionValidatorService which is the single source of truth
 * for "can actor X perform action Y in conversation Z?".
 *
 * The orchestrator assumes the payload is 100% valid and safe once
 * InteractionValidatorService.validateInteractionOrThrow() returns without throwing.
 */
@Injectable()
export class MessageSendOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(MessageSendOrchestrator.name);

  private kafkaOutboxHandle: ReturnType<typeof setInterval> | null = null;
  private isOutboxProcessing = false;

  constructor(
    private readonly interactionValidator: InteractionValidatorService,
    private readonly rateLimiter: MessageRateLimiterService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly registry: ServiceRegistry,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    // Background processor: drain Redis outbox → Kafka every 500 ms.
    this.kafkaOutboxHandle = setInterval(() => {
      if (this.isOutboxProcessing) return;
      this.isOutboxProcessing = true;
      this.processKafkaOutbox()
        .catch((err) => this.logger.warn(`Outbox processor error: ${err?.message}`))
        .finally(() => { this.isOutboxProcessing = false; });
    }, 500);
  }

  onModuleDestroy(): void {
    if (this.kafkaOutboxHandle) clearInterval(this.kafkaOutboxHandle);
  }

  /**
   * Execute the send-message flow.
   *
   * The orchestrator owns exactly three concerns:
   *   1. Rate limiting (fast-fail before I/O)
   *   2. Content sanity check (pure CPU)
   *   3. Kafka outbox publishing
   *
   * Interaction policy (membership / block / allowMemberMessage) is enforced
   * by InteractionValidatorService before this method is invoked, OR inside
   * this method when called over TCP (chat-core consumer path).
   */
  async execute(dto: SendMessageDto): Promise<SendMessageResult> {
    const messageId = this.normalizeMessageId(dto.clientMessageId);

    const externalDeadline = (dto as any)._deadline as number | undefined;
    const withDeadline = <T>(p: Promise<T>): Promise<T> => {
      if (!externalDeadline) return p;
      const remaining = externalDeadline - Date.now() - 2000;
      if (remaining <= 0) {
        return Promise.reject(
          Object.assign(new Error('REQUEST_DEADLINE_EXCEEDED'), { code: 'REQUEST_DEADLINE_EXCEEDED' }),
        );
      }
      return Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(Object.assign(new Error('REQUEST_DEADLINE_EXCEEDED'), { code: 'REQUEST_DEADLINE_EXCEEDED' })),
            remaining,
          ),
        ),
      ]);
    };

    try {
      const t0 = Date.now();

      // Step 1: Rate limit (fast-fail before any I/O)
      await this.rateLimiter.checkLimitOrThrow(
        dto.senderId,
        null,
        this.hasMentionIntent(dto) ? 'mention' : dto.type,
      );

      // Step 2: Content validation (pure CPU)
      this.validateMessageContent(dto.content, dto.type, dto.metadata?.mediaId, dto.attachments);
      await this.validateContactCard(dto);
      this.logger.log(`[perf] rateLimit+content=${Date.now() - t0}ms`);

      // Step 3: Unified Interaction Policy — membership + block + allowMemberMessage
      // Returns the validated context including conversation type, members, and
      // receiverId/relationshipMetadata for DIRECT conversations.
      const t1 = Date.now();
      const ctx = await withDeadline(
        this.interactionValidator.validateInteractionOrThrow(
          dto.senderId,
          dto.conversationId,
          'SEND',
        ),
      );
      this.logger.log(`[perf] interactionValidation=${Date.now() - t1}ms`);

      const { conversation, relationshipMetadata = {} } = ctx;
      const mentions = this.normalizeMentions(dto, conversation.type, ctx.members);

      // Step 4: Enqueue to Redis outbox (decoupled from Kafka broker availability)
      const kafkaEventData = {
        messageId,
        conversationId: dto.conversationId,
        conversationType: conversation.type,
        senderId: dto.senderId,
        senderName: dto.senderName,
        conversationName:
          conversation.type !== ConversationType.DIRECT
            ? (conversation.name ?? undefined)
            : undefined,
        content: dto.content || '',
        type: dto.type,
        replyToId: dto.replyToMessageId ?? dto.metadata?.replyToId,
        mentions,
        timestamp: new Date(),
        metadata: {
          ...dto.metadata,
          ...(mentions && { mentions }),
          ...(dto.metadata?.mentionAll === true && { mentionAll: true }),
          ...(dto.replyToMessageId && { replyToId: dto.replyToMessageId }),
          ...relationshipMetadata,
          clientMessageId: dto.clientMessageId,
        },
        attachments: (dto as any).attachments ?? undefined,
      };

      await withDeadline(this.enqueueKafkaOutbox(kafkaEventData));

      return {
        success: true,
        messageId,
        conversationId: dto.conversationId,
        metadata: {
          messageType: relationshipMetadata.messageType,
          relationshipType: relationshipMetadata.relationshipType,
        },
      };
    } catch (error: unknown) {
      const errAny = error as any;
      if (
        errAny?.status === 503 ||
        errAny?.name === 'ServiceUnavailableException' ||
        ['UNAVAILABLE', 'ECONNREFUSED', 'TIMEOUT', 'REQUEST_DEADLINE_EXCEEDED', 'FAILED_TO_PUBLISH_EVENT'].some(
          (k) => (errAny?.message ?? '').includes(k),
        )
      ) {
        throw error;
      }
      this.logger.error(`Message send orchestration failed:`, String(error));
      return this.formatErrorResult(messageId, dto.conversationId, error);
    }
  }

  /**
   * Extract a structured error result from any thrown value.
   */
  private formatErrorResult(
    messageId: string,
    conversationId: string,
    error: unknown,
  ): SendMessageResult {
    const caughtError = error as any;
    const rpcPayload =
      typeof caughtError.getError === 'function' ? caughtError.getError() : undefined;
    const errorResponse =
      (rpcPayload && typeof rpcPayload === 'object' ? rpcPayload : null) ??
      caughtError.response ??
      {};
    return {
      success: false,
      messageId,
      conversationId,
      error: {
        code: errorResponse.errorCode || caughtError.name || 'MESSAGE_SEND_FAILED',
        message: errorResponse.message || caughtError.message || 'Message send failed',
        details: errorResponse.details || caughtError.metadata || {},
      },
    };
  }

  private normalizeMessageId(clientMessageId?: string): string {
    if (!clientMessageId) return uuidv4();

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(clientMessageId)) return clientMessageId;

    return uuidv4();
  }

  private hasMentionIntent(dto: SendMessageDto): boolean {
    const metadataMentions = dto.metadata?.mentions;
    return (
      (Array.isArray(dto.mentions) && dto.mentions.length > 0) ||
      (Array.isArray(metadataMentions) && metadataMentions.length > 0) ||
      dto.metadata?.mentionAll === true
    );
  }

  private normalizeMentions(
    dto: SendMessageDto,
    conversationType: string,
    members: Array<{ userId: string; role?: string }>,
  ): string[] | undefined {
    const rawMentions = Array.isArray(dto.mentions)
      ? dto.mentions
      : Array.isArray(dto.metadata?.mentions)
        ? dto.metadata?.mentions
        : [];

    const specialMentionTokens = new Set(['all', '@all', 'here', '@here', 'channel', '@channel']);
    const hasMentionAll =
      dto.metadata?.mentionAll === true ||
      rawMentions.some((value) => specialMentionTokens.has(String(value).trim().toLowerCase()));

    const explicitMentions = rawMentions
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0 && !specialMentionTokens.has(value.toLowerCase()));

    if (!hasMentionAll && explicitMentions.length === 0) return undefined;

    if (
      conversationType !== ConversationType.GROUP &&
      conversationType !== ConversationType.ANNOUNCEMENT
    ) {
      throw new BadRequestException('MENTIONS_NOT_SUPPORTED_FOR_CONVERSATION_TYPE', {
        conversationType,
        supportedTypes: [ConversationType.GROUP, ConversationType.ANNOUNCEMENT],
      });
    }

    const memberIds = new Set(members.map((member) => member.userId));
    const normalized = hasMentionAll
      ? members.map((member) => member.userId).filter((userId) => userId !== dto.senderId)
      : Array.from(new Set(explicitMentions));

    const invalidMentionIds = normalized.filter((userId) => !memberIds.has(userId));
    if (invalidMentionIds.length > 0) {
      throw new BadRequestException('MENTION_TARGET_NOT_MEMBER', {
        conversationId: dto.conversationId,
        invalidMentionIds,
      });
    }

    if (normalized.length > 50 && !hasMentionAll) {
      throw new BadRequestException('TOO_MANY_MENTIONS', {
        limit: 50,
        received: normalized.length,
      });
    }

    return normalized.length > 0 ? normalized : undefined;
  }

  /**
   * Validate message content
   *
   * @param content - Message content
   * @param type - Message type
   * @param mediaId - Media ID (optional)
   * @throws BadRequestException if invalid
   */
  private validateMessageContent(
    content: string,
    type: string,
    mediaId?: string,
    attachments?: { mediaId: string }[],
  ): void {
    const isContentEmpty = !content || content.trim().length === 0;

    // Validation rules by message type
    switch (type) {
      case 'text':
      case undefined:
        // Text messages REQUIRE content
        if (isContentEmpty) {
          throw new BadRequestException('MESSAGE_CONTENT_REQUIRED', {
            message: 'Content is required for text messages',
          });
        }
        break;

      case 'sticker':
        // Sticker messages: content optional, metadata contains sticker URL
        // No mediaId/attachments validation needed
        break;

      case 'contact_card':
        if (!mediaId && !attachments?.length) {
          // contact_card uses metadata, not media files.
          break;
        }
        throw new BadRequestException('CONTACT_CARD_MEDIA_NOT_ALLOWED', {
          message: 'Contact card messages must not include media attachments',
        });

      case 'media':
        // Media messages (multi-attachment): content optional, attachments array REQUIRED
        if (!attachments || attachments.length === 0) {
          throw new BadRequestException('ATTACHMENTS_REQUIRED', {
            message: 'At least one attachment is required for type "media"',
            hint: 'Upload media files first, then include mediaId in attachments array',
          });
        }
        if (attachments.length > 30) {
          throw new BadRequestException('TOO_MANY_ATTACHMENTS', {
            message: 'Maximum 30 attachments per message',
            limit: 30,
            received: attachments.length,
          });
        }
        break;

      case 'image':
      case 'video':
      case 'audio':
      case 'file':
        // Single media messages: content optional, mediaId OR attachments REQUIRED
        const hasMedia = !!mediaId || (attachments && attachments.length > 0);
        if (!hasMedia) {
          throw new BadRequestException('MEDIA_DATA_REQUIRED', {
            message: `Media data is required for type "${type}"`,
            hint: 'Upload the file first using POST /media/upload, then include the mediaId or attachments array',
          });
        }
        break;

      default:
        // Unknown message type - treat as text
        if (isContentEmpty) {
          throw new BadRequestException('MESSAGE_CONTENT_REQUIRED', {
            message: `Content is required for message type "${type}"`,
          });
        }
    }

    // Validate content length (max 10000 characters) if content provided
    if (content && content.length > 10000) {
      throw new BadRequestException('MESSAGE_CONTENT_TOO_LONG', {
        maxLength: 10000,
        actualLength: content.length,
      });
    }

    // TODO: Add profanity filter, spam detection, etc.
  }

  private async validateContactCard(dto: SendMessageDto): Promise<void> {
    if (dto.type !== 'contact_card') return;

    const contactUserId = String(dto.metadata?.contactUserId ?? '').trim();
    if (!contactUserId) {
      throw new BadRequestException('CONTACT_USER_REQUIRED', {
        message: 'metadata.contactUserId is required for contact_card messages',
      });
    }
    if (contactUserId === dto.senderId) {
      throw new BadRequestException('CANNOT_SHARE_SELF_CONTACT', {
        message: 'You cannot send your own contact card with this endpoint',
      });
    }

    const friendship = this.registry.resolve<IFriendshipService>(
      SERVICE_NAMES.FRIENDSHIP,
    );
    if (!friendship) {
      throw new ServiceUnavailableException('FRIENDSHIP_SERVICE_UNAVAILABLE');
    }

    const isFriend = await friendship.areFriends(dto.senderId, contactUserId);
    if (!isFriend) {
      throw new ForbiddenException('CONTACT_USER_NOT_FRIEND', {
        contactUserId,
      });
    }

    // Enrich contact card with email and avatarId so FE can render the card
    // without a separate user-profile fetch. Soft-fail: if users-service is
    // unavailable, the card is still sent with just the contactUserId.
    let contactEmail: string | undefined;
    let contactAvatarId: string | undefined;
    let contactUsername: string | undefined;
    try {
      const userService = this.registry.resolve<IUserService>(SERVICE_NAMES.USERS);
      if (userService) {
        const contactUser = await userService.getUser(contactUserId);
        if (contactUser) {
          contactEmail = contactUser.email;
          contactAvatarId = contactUser.avatarMediaId ?? undefined;
          contactUsername = contactUser.username;
        }
      }
    } catch {
      // Non-critical: proceed without enrichment
    }

    dto.content = dto.content || '';
    dto.metadata = {
      ...dto.metadata,
      contactUserId,
      cardType: 'friend_contact',
      ...(contactEmail !== undefined && { contactEmail }),
      ...(contactAvatarId !== undefined && { contactAvatarId }),
      ...(contactUsername !== undefined && { contactUsername }),
    };
  }

  /**
   * Publish MESSAGE_ACCEPTED event to Kafka
   *
   * @param eventData - Event data
   */
  private async publishMessageAcceptedEvent(eventData: any): Promise<void> {
    try {
      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.EVENTS.MESSAGE_ACCEPTED,
          // Partition by conversationId to guarantee per-conversation ordering
          key: eventData.conversationId,
          // acks:-1 (all replicas) is REQUIRED when the shared producer uses
          // idempotent:true. Using acks:1 here caused
          // KafkaJSNonRetriableError ("Not requiring ack for all messages
          // invalidates the idempotent producer's EoS guarantees").
          acks: -1,
          timeout: 5000,
        },
        eventData,
      );
      // Published log removed for production throughput
    } catch (error: unknown) {
      this.logger.error('Failed to publish MESSAGE_ACCEPTED event:', String(error));
      throw new ServiceUnavailableException('FAILED_TO_PUBLISH_EVENT', {
        conversationId: eventData?.conversationId,
        messageId: eventData?.messageId,
      });
    }
  }

  /**
   * Persist event to Redis outbox. This keeps the sync request path independent
   * from Kafka network/broker availability while preserving eventual delivery.
   */
  private async enqueueKafkaOutbox(eventData: any): Promise<void> {
    try {
      await this.redis.lpush(REDIS_KEYS.CHAT.KAFKA_OUTBOX, JSON.stringify(eventData));
    } catch (error: unknown) {
      this.logger.error(
        `FAILED_TO_ENQUEUE_OUTBOX for message ${eventData?.messageId}: ${String(error)}`,
      );
      throw new ServiceUnavailableException('FAILED_TO_PUBLISH_EVENT', {
        conversationId: eventData?.conversationId,
        messageId: eventData?.messageId,
      });
    }
  }

  /**
   * Background outbox processor: drain chat:kafka:outbox and publish to Kafka.
   * Runs every 500ms via setInterval.
   *
   * Optimisation: fetches up to MAX_PER_TICK items in a single LPOP call (Redis 6.2+)
   * and publishes them concurrently via Promise.allSettled, reducing tick latency
   * from O(N × roundtrip) to O(1 × roundtrip) under burst traffic.
   */
  private async processKafkaOutbox(): Promise<void> {
    const MAX_PER_TICK = 10;

    let rawItems: string[] | null = null;
    try {
      // LPOP with count requires Redis ≥ 6.2 (docker-compose uses redis:7-alpine)
      rawItems = (await (this.redis as any).lpop(
        REDIS_KEYS.CHAT.KAFKA_OUTBOX,
        MAX_PER_TICK,
      )) as string[] | null;
    } catch {
      return; // Redis unavailable — try again next tick
    }

    if (!rawItems || rawItems.length === 0) return;

    // Publish all items concurrently; collect failures for re-queue
    const results = await Promise.allSettled(
      rawItems.map(async (raw) => {
        let eventData: any;
        try {
          eventData = JSON.parse(raw);
        } catch {
          this.logger.warn(`Kafka outbox: invalid JSON, discarding: ${raw.substring(0, 80)}`);
          return null; // discard unparseable items
        }
        await this.kafkaProducer.publish(
          {
            topic: KAFKA_TOPICS.EVENTS.MESSAGE_ACCEPTED,
            key: eventData.conversationId,
            acks: -1,
            timeout: 5000,
          },
          eventData,
        );
        return null; // success sentinel
      }),
    );

    // Re-queue items whose publish failed (rejected = Kafka still down)
    const failedItems = rawItems.filter((_, i) => results[i].status === 'rejected');
    if (failedItems.length > 0) {
      this.logger.warn(`Kafka outbox: requeuing ${failedItems.length} failed messages.`);
      this.redis.lpush(REDIS_KEYS.CHAT.KAFKA_OUTBOX, ...failedItems).catch(() => {});
    }
  }

  /**
   * Get orchestration statistics for monitoring
   */
  async getStats(): Promise<Record<string, any>> {
    return {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}

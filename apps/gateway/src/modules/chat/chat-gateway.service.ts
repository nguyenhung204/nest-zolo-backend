import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  SERVICES,
  MESSAGE_STORE_PATTERNS,
  CHAT_CORE_PATTERNS,
  CircuitBreakerService,
  createProtectedProxy,
  createLogger,
  withTrace,
} from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';

/**
 * Chat Gateway Service
 *
 * Unified Pipeline — Synchronous validation + Kafka persistence:
 *   Gateway → TCP SEND_MESSAGE → Chat Core (validate + Kafka publish) → 201 Created
 *
 * Chat Core performs full validation (rate limit, ACL, block check) synchronously
 * and publishes MESSAGE_ACCEPTED to Kafka before returning. This guarantees:
 *   1. No silent message loss (Kafka durability vs Redis list)
 *   2. Correct per-conversation ordering (Kafka partition key = conversationId)
 *   3. Honest HTTP response (403/429 on validation failure, not false 202)
 */
@Injectable()
export class ChatGatewayService extends BaseGatewayService {
  private readonly logger = createLogger(ChatGatewayService.name);

  constructor(
    @Inject(SERVICES.MESSAGE_STORE) messageStoreClient: ClientProxy,
    @Inject(SERVICES.CHAT_CORE) private chatCoreClient: any,
    private readonly cbService: CircuitBreakerService,
  ) {
    super(messageStoreClient, cbService, 'message-store');
    this.chatCoreClient = chatCoreClient;
  }

  private get chatCoreProxy() {
    return createProtectedProxy(
      this.chatCoreClient,
      this.cbService,
      'chat-core',
      undefined,
      15000,
      0,
    );
  }

  /**
   * Get messages from ANY conversation (offset-based)
   *
   * @param conversationId - Conversation ID
   * @param userId - User ID (for authorization check)
   * @param query - { after?, before?, limit }
   */
  async getMessages(
    conversationId: string,
    userId: string,
    query: { after?: number; before?: number; limit: number },
  ) {
    return this.proxy.send(MESSAGE_STORE_PATTERNS.GET_MESSAGES, {
      conversationId,
      userId,
      ...query,
    });
  }

  /**
   * Send a message via synchronous TCP call to Chat Core.
   *
   * Chat Core validates (rate limit, ACL, block check) and publishes to Kafka.
   * On success: returns messageId + 201 Created.
   * On business error: throws HttpException (403/429) — gateway propagates to client.
   * On infra error: throws 503 — circuit breaker protects downstream.
   */
  async sendMessage(data: {
    conversationId: string;
    senderId: string;
    senderName?: string;
    content?: string;
    type?: string;
    replyToMessageId?: string;
    metadata?: Record<string, any>;
    mentions?: string[];
    clientMessageId: string;
    attachments?: Array<{
      mediaId: string;
      type?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      width?: number;
      height?: number;
      durationMs?: number;
      thumbUrl?: string;
    }>;
  }) {
    const result = await this.chatCoreProxy.send(
      CHAT_CORE_PATTERNS.SEND_MESSAGE,
      withTrace({
        conversationId: data.conversationId,
        senderId: data.senderId,
        senderName: data.senderName,
        content: data.content,
        type: data.type || 'text',
        replyToMessageId: data.replyToMessageId,
        metadata: data.metadata,
        mentions: data.mentions,
        clientMessageId: data.clientMessageId,
        attachments: data.attachments,
      }),
    );

    return {
      messageId: result.messageId,
      clientMessageId: data.clientMessageId,
      conversationId: data.conversationId,
      status: 'created',
    };
  }

  /**
   * Pre-check media upload (Phase 1 of two-phase commit)
   *
   * Validates if user can send media in conversation BEFORE file upload.
   * Returns approval if all checks pass (tenant, membership, ACL).
   *
   * This prevents wasted storage from uploading files that will be rejected.
   */
  async preCheckMedia(data: {
    conversationId: string;
    senderId: string;
    mimeType: string;
    fileSize: number;
  }) {
    return this.chatCoreProxy.send(CHAT_CORE_PATTERNS.PRE_CHECK_MEDIA, data);
  }
}

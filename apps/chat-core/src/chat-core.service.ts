import { InjectRedis } from '@app/cache';
import { createLogger, REDIS_KEYS, REDIS_TTL } from '@app/common';
import { HttpStatus, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import Redis from 'ioredis';
import { SendMessageDto } from './dto/send-message.dto';
import { PreCheckMediaDto } from './dto/pre-check-media.dto';
import { MessageSendOrchestrator } from './orchestrators/message-send.orchestrator';
import { MessageEditOrchestrator } from './orchestrators/message-edit.orchestrator';
import { MessageDeleteOrchestrator } from './orchestrators/message-delete.orchestrator';
import { MessagePinOrchestrator } from './orchestrators/message-pin.orchestrator';
import { MediaPreCheckOrchestrator } from './orchestrators/media-precheck.orchestrator';
import { MessageRevokeOrchestrator } from './orchestrators/message-revoke.orchestrator';
import { MessageDeleteForUserOrchestrator } from './orchestrators/message-delete-for-user.orchestrator';
import { MessageForwardOrchestrator } from './orchestrators/message-forward.orchestrator';
import { RevokeMessageDto } from './dto/revoke-message.dto';
import { DeleteMessageForUserDto } from './dto/delete-message-for-user.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';

@Injectable()
export class ChatCoreService {
  private readonly logger = createLogger(ChatCoreService.name);

  private activeSends = 0;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly sendOrchestrator: MessageSendOrchestrator,
    private readonly editOrchestrator: MessageEditOrchestrator,
    private readonly deleteOrchestrator: MessageDeleteOrchestrator,
    private readonly pinOrchestrator: MessagePinOrchestrator,
    private readonly mediaPreCheckOrchestrator: MediaPreCheckOrchestrator,
    private readonly revokeOrchestrator: MessageRevokeOrchestrator,
    private readonly deleteForUserOrchestrator: MessageDeleteForUserOrchestrator,
    private readonly forwardOrchestrator: MessageForwardOrchestrator,
  ) {}

  // ================================================================
  // Public API — thin routing layer, all logic in orchestrators
  // ================================================================

  async sendMessage(data: SendMessageDto) {
    this.activeSends++;
    try {
      return await this._sendMessage(data);
    } finally {
      this.activeSends--;
    }
  }

  private async _sendMessage(data: SendMessageDto) {
    // Deadline guard: reject immediately if budget already exhausted before any I/O
    if ((data as any)._deadline && Date.now() >= (data as any)._deadline) {
      throw new RpcException({
        statusCode: 503,
        message: 'REQUEST_DEADLINE_EXCEEDED',
        errorCode: 'SERVICE_OVERLOADED',
      });
    }

    // Idempotency guard: return existing result if clientMessageId was already processed
    if (data.clientMessageId) {
      const key = `${REDIS_KEYS.IDEMPOTENCY.MESSAGE}${data.clientMessageId}`;
      // Race against 500 ms: if Redis is slow (e.g. connection queued under
      // spike traffic), skip the cache rather than blocking the entire request
      // for tens of seconds.  Duplicate processing is harmless — the orchestrator
      // will re-publish the same messageId and message-store is idempotent.
      let existing: string | null = null;
      try {
        existing = await Promise.race<string | null>([
          this.redis.get(key),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 200)),
        ]);
      } catch {
        // Redis error — proceed without idempotency check
      }
      if (existing) {
        this.logger.log(
          `Duplicate send detected (clientMessageId: ${data.clientMessageId})`,
        );
        return {
          success: true,
          messageId: existing,
          conversationId: data.conversationId,
          senderId: data.senderId,
          content: data.content || '',
          type: data.type || 'text',
          metadata: data.metadata,
          createdAt: new Date(),
          isDuplicate: true,
        };
      }
    }

    const result = await this.sendOrchestrator.execute(data as any);
    if (!result.success) {
      this.throwRpcException(result.error);
    }

    // Persist idempotency mapping for 24 hours (fire-and-forget — response path)
    if (data.clientMessageId) {
      this.redis
        .setex(
          `${REDIS_KEYS.IDEMPOTENCY.MESSAGE}${data.clientMessageId}`,
          REDIS_TTL.IDEMPOTENCY.MESSAGE,
          result.messageId,
        )
        .catch((err) =>
          this.logger.warn(`Failed to persist idempotency key: ${err?.message}`),
        );
    }

    return {
      success: true,
      messageId: result.messageId,
      conversationId: data.conversationId,
      senderId: data.senderId,
      content: data.content || '',
      type: data.type || 'text',
      metadata: { ...data.metadata, ...(result.metadata || {}) },
      createdAt: new Date(),
    };
  }

  async editMessage(data: {
    messageId: string;
    senderId: string;
    content: string;
    metadata?: Record<string, any>;
  }) {
    this.logger.log(`Edit message: ${data.messageId} by ${data.senderId}`);
    const result = await this.editOrchestrator.execute(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async deleteMessage(data: { messageId: string; deletedBy: string }) {
    this.logger.log(`Delete message: ${data.messageId} by ${data.deletedBy}`);
    const result = await this.deleteOrchestrator.execute(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async pinMessage(data: {
    conversationId?: string;
    messageId: string;
    pinnedBy: string;
  }) {
    this.logger.log(
      `Pin message: ${data.messageId} in ${data.conversationId} by ${data.pinnedBy}`,
    );
    const result = await this.pinOrchestrator.pin(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async unpinMessage(data: {
    conversationId?: string;
    messageId: string;
    unpinnedBy: string;
  }) {
    this.logger.log(
      `Unpin message: ${data.messageId} in ${data.conversationId} by ${data.unpinnedBy}`,
    );
    const result = await this.pinOrchestrator.unpin(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async revokeMessage(data: RevokeMessageDto & { revokedBy: string }) {
    this.logger.log(`Revoke message: ${data.messageId} by ${data.revokedBy}`);
    const result = await this.revokeOrchestrator.execute(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async deleteMessageForUser(data: DeleteMessageForUserDto & { userId: string }) {
    this.logger.log(`Delete-for-user: ${data.messageId} by ${data.userId}`);
    const result = await this.deleteForUserOrchestrator.execute(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async forwardMessage(data: ForwardMessageDto & { forwardedBy: string }) {
    this.logger.log(
      `Forward message: ${data.sourceMessageId} → ${data.targetConversationIds.length} conversations by ${data.forwardedBy}`,
    );
    const result = await this.forwardOrchestrator.execute(data);
    if (!result.success) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  async preCheckMedia(data: PreCheckMediaDto) {
    this.logger.log(
      `Pre-check media: conversation=${data.conversationId} sender=${data.senderId}`,
    );
    const result = await this.mediaPreCheckOrchestrator.execute(data);
    if (!result.approved) {
      this.throwRpcException(result.error);
    }
    return result;
  }

  // ================================================================
  // Private helpers
  // ================================================================

  /**
   * Convert an orchestrator error object → RpcException with correct HTTP status.
   *
   * Status mapping (conservative):
   *   FORBIDDEN_* | USER_VALIDATION_FAILED     → 403
   *   *_NOT_FOUND | MESSAGE_NOT_FOUND          → 404
   *   *_UNAVAILABLE | *_SERVICE_* | *_TIMEOUT  → 503
   *   everything else                           → 400
   */
  private throwRpcException(error?: {
    code: string;
    message: string;
    details?: any;
  }): never {
    const code = error?.code || 'UNKNOWN_ERROR';
    const message = error?.message || 'Operation failed';
    let statusCode: number;

    if (code.startsWith('FORBIDDEN') || code === 'USER_VALIDATION_FAILED' || code === 'AUTH_INSUFFICIENT_PERMISSIONS') {
      statusCode = HttpStatus.FORBIDDEN;
    } else if (code === 'RATE_LIMIT_EXCEEDED' || code.startsWith('RATE_LIMIT')) {
      statusCode = HttpStatus.TOO_MANY_REQUESTS;
    } else if (code.includes('NOT_FOUND')) {
      statusCode = HttpStatus.NOT_FOUND;
    } else if (
      code.includes('UNAVAILABLE') ||
      code.includes('SERVICE') ||
      code.includes('TIMEOUT') ||
      // Catch lowercase/mixed-case variants produced by exception message passthrough
      code.toLowerCase().includes('unavailable') ||
      code.toLowerCase().includes('service') ||
      code.toLowerCase().includes('timeout')
    ) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
    } else {
      statusCode = HttpStatus.BAD_REQUEST;
    }

    throw new RpcException({ statusCode, message, errorCode: code });
  }
}

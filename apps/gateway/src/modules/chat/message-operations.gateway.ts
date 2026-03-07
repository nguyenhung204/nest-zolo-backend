import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  SERVICES,
  CHAT_CORE_PATTERNS,
  MESSAGE_STORE_PATTERNS,
  CircuitBreakerService,
} from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';

/**
 * Message Operations Gateway Service (SDK/Facade Pattern)
 *
 * Hard-fail: CHAT_CORE is critical for all message operations.
 * MESSAGE_STORE is used for the Zero-Kafka reaction path.
 */
@Injectable()
export class MessageOperationsGatewayService extends BaseGatewayService {
  private readonly messageStoreProxy: ClientProxy;

  constructor(
    @Inject(SERVICES.CHAT_CORE) client: any,
    cbService: CircuitBreakerService,
    @Inject(SERVICES.MESSAGE_STORE) messageStoreClient: ClientProxy,
  ) {
    super(client, cbService, 'chat-core');
    this.messageStoreProxy = messageStoreClient;
  }

  async editMessage(data: {
    messageId: string;
    senderId: string;
    content: string;
    metadata?: Record<string, any>;
  }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.EDIT_MESSAGE, data);
  }

  async deleteMessage(data: { messageId: string; deletedBy: string }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.DELETE_MESSAGE, data);
  }

  async pinMessage(data: {
    conversationId?: string;
    messageId: string;
    pinnedBy: string;
  }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.PIN_MESSAGE, data);
  }

  async unpinMessage(data: {
    conversationId?: string;
    messageId: string;
    unpinnedBy: string;
  }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.UNPIN_MESSAGE, data);
  }

  async getPinnedMessages(conversationId: string) {
    return this.proxy.send(CHAT_CORE_PATTERNS.GET_PINNED_MESSAGES, {
      conversationId,
    });
  }

  async revokeMessage(data: {
    messageId: string;
    conversationId: string;
    revokedBy: string;
    reason?: string;
  }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.REVOKE_MESSAGE, data);
  }

  async deleteMessageForMe(data: {
    messageId: string;
    conversationId: string;
    userId: string;
  }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.DELETE_MESSAGE_FOR_USER, data);
  }

  async forwardMessage(data: {
    sourceMessageId: string;
    sourceConversationId: string;
    targetConversationIds: string[];
    forwardedBy: string;
    forwarderName?: string;
    includeCaption?: boolean;
  }) {
    return this.proxy.send(CHAT_CORE_PATTERNS.FORWARD_MESSAGE, data);
  }

  /**
   * React to a message (Zero-Kafka path)
   *
   * Bypasses ChatCore and Kafka entirely — goes directly to MessageStore
   * which writes to Redis Hash + Pub/Sub → RealtimeGateway → WebSocket.
   */
  async reactMessage(data: {
    messageId: string;
    conversationId: string;
    reactorId: string;
    emoji: string;
    action?: 'add' | 'remove';
  }) {
    return this.messageStoreProxy
      .send(MESSAGE_STORE_PATTERNS.REACT_MESSAGE, data)
      .toPromise();
  }
}

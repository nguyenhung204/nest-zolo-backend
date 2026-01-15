import { Injectable } from '@nestjs/common';
import {
  KAFKA_TOPICS,
  createLogger,
} from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { ChatGateway } from '../chat/chat.gateway';
import { UserEnrichmentService } from './user-enrichment.service';

interface MessageUpdatedPayload {
  messageId: string;
  conversationId: string;
  senderId?: string;
  patch: {
    isRevoked?: boolean;
    revokedAt?: string;
    tombstoneTextKey?: string;
    isDeleted?: boolean;
    deletedAt?: string;
    content?: string;
    isEdited?: boolean;
    editedAt?: string;
    isPinned?: boolean;
    pinnedBy?: string;
    pinnedAt?: string;
    unpinnedBy?: string;
    unpinnedAt?: string;
    attachment?: {
      mediaId: string;
      kind: string;
      status: 'READY' | 'FAILED';
      variantsReady?: boolean;
      thumbReady?: boolean;
      meta?: Record<string, any>;
      error?: { code: string; message: string };
    };
  };
}

/**
 * Message Updated Consumer
 *
 * Consumes MESSAGE_UPDATED events and routes to specific WS events:
 *   - patch.isRevoked    → message:revoked
 *   - patch.isDeleted    → message:deleted
 *   - patch.content      → message:edited
 *   - patch.attachment   → message:media_ready  (media processing complete)
 *   - fallback           → message:updated
 */
@Injectable()
export class MessageUpdatedConsumer {
  private readonly logger = createLogger(MessageUpdatedConsumer.name);

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly userEnrichment: UserEnrichmentService,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.EVENTS.MESSAGE_UPDATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleMessageUpdated(payload: MessageUpdatedPayload): Promise<void> {
    try {
      this.logger.log(
        `Processing MESSAGE_UPDATED for message ${payload.messageId}`,
      );

      const { patch } = payload;

      if (patch.isRevoked) {
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:revoked',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            revokedAt: patch.revokedAt,
            tombstoneTextKey: patch.tombstoneTextKey ?? 'message.revoked',
          },
        );
      } else if (patch.isDeleted) {
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:deleted',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            deletedAt: patch.deletedAt,
          },
        );
      } else if (patch.content !== undefined) {
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:edited',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            content: patch.content,
            isEdited: patch.isEdited ?? true,
            editedAt: patch.editedAt,
          },
        );
      } else if (patch.isPinned === true) {
        const pinnedBy = patch.pinnedBy;
        const names = await this.userEnrichment.getDisplayNames(
          pinnedBy ? [pinnedBy] : [],
        );
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:pinned',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            pinnedBy,
            pinnedByName: pinnedBy ? names.get(pinnedBy) : undefined,
            pinnedAt: patch.pinnedAt,
          },
        );
      } else if (patch.isPinned === false) {
        const unpinnedBy = patch.unpinnedBy;
        const names = await this.userEnrichment.getDisplayNames(
          unpinnedBy ? [unpinnedBy] : [],
        );
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:unpinned',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            unpinnedBy,
            unpinnedByName: unpinnedBy ? names.get(unpinnedBy) : undefined,
            unpinnedAt: patch.unpinnedAt,
          },
        );
      } else if (patch.attachment) {
        // Media processing completed — emit dedicated event for FE to update media
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:media_ready',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            attachment: patch.attachment,
          },
        );
      } else {
        // Generic fallback
        this.chatGateway.broadcastToConversation(
          payload.conversationId,
          'message:updated',
          {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            ...patch,
          },
        );
      }

      this.logger.log(
        `Broadcast update to room conversation:${payload.conversationId} for message ${payload.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process MESSAGE_UPDATED: ${error.message}`,
        error.stack,
      );
    }
  }
}

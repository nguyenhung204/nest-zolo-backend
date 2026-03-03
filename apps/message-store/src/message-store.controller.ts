import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MESSAGE_STORE_PATTERNS } from '@app/common';
import { MessageStoreService } from './message-store.service';
import { StickerRepository } from './infrastructure/repositories/sticker.repository';

/**
 * Message Store Controller
 *
 * TCP endpoints for reading messages (offset-based for all conversation types)
 *
 * Offset tracking (UPDATE_LAST_SEEN_OFFSET, GET_UNREAD_COUNT) belongs to
 * ConversationService — callers should use CONVERSATION_PATTERNS directly.
 */
@Controller()
export class MessageStoreController {
  constructor(
    private readonly messageStoreService: MessageStoreService,
    private readonly stickerRepository: StickerRepository,
  ) {}

  /**
   * Get messages from ANY conversation (offset-based)
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_MESSAGES)
  async getMessages(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      after?: number;
      before?: number;
      limit: number;
    },
  ) {
    return this.messageStoreService.getMessages(data);
  }

  /**
   * Get messages around a specific messageId (context window for Jump to Message)
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_MESSAGES_AROUND)
  async getMessagesAround(
    @Payload()
    data: {
      conversationId: string;
      userId: string;
      messageId: string;
      limit?: number;
    },
  ) {
    return this.messageStoreService.getMessagesAround(data);
  }

  /**
   * Get single message by ID (for status computation)
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_MESSAGE_BY_ID)
  async getMessageById(@Payload() data: { messageId: string }) {
    const message = await this.messageStoreService.getMessageById(
      data.messageId,
    );

    if (!message) {
      return null;
    }

    // Return serialized message
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content ?? '',
      type: message.type,
      offset: Number(message.offset ?? 0),
      metadata: message.metadata,
      mentions: Array.isArray(message.metadata?.mentions)
        ? message.metadata.mentions
        : undefined,
      attachments: message.attachments ?? [],
      isRevoked: message.isRevoked,
      isDeleted: message.isDeleted,
      replyToId: message.replyToId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  /**
   * Check if user has replied in conversation
   * Used by ChatCore to determine if message should go to inbox or message request
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.HAS_REPLIED)
  async hasReplied(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    return this.messageStoreService.hasReplied(
      data.conversationId,
      data.userId,
    );
  }

  /**
   * Get pinned messages in conversation
   * Returns up to 3 pinned messages (enterprise business rule)
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_PINNED_MESSAGES)
  async getPinnedMessages(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    return this.messageStoreService.getPinnedMessages(data.conversationId);
  }

  // ─── Sticker Catalog ────────────────────────────────────────────────────────

  /**
   * Return all sticker packages (id, name, thumbnailUrl, isFree).
   * Frontend uses this to render the sticker-keyboard tab bar.
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_STICKER_PACKAGES)
  async getStickerPackages() {
    return this.stickerRepository.findAllPackages();
  }

  /**
   * Return paginated stickers for a given package.
   *
   * @param packageId  - ID of the sticker package
   * @param limit      - Max items per page (default 50)
   * @param offset     - Row offset for pagination (default 0)
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_PACKAGE_STICKERS)
  async getPackageStickers(
    @Payload() data: { packageId: string; limit?: number; offset?: number },
  ) {
    return this.stickerRepository.findByPackage(
      data.packageId,
      data.limit ?? 50,
      data.offset ?? 0,
    );
  }

  /**
   * React to a message (Zero-Kafka path)
   *
   * Called by Gateway HTTP layer → TCP → here → Redis HSET + PUBLISH
   * No Kafka involved — fast path for high-frequency reactions
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.REACT_MESSAGE)
  async reactToMessage(
    @Payload()
    data: {
      messageId: string;
      conversationId: string;
      reactorId: string;
      emoji: string;
      action?: 'add' | 'remove';
    },
  ) {
    return this.messageStoreService.reactToMessage(data);
  }

  /**
   * Batch-fetch the last message per conversation (for conversation list enrichment)
   */
  @MessagePattern(MESSAGE_STORE_PATTERNS.GET_LAST_MESSAGES_BATCH)
  async getLastMessagesBatch(
    @Payload() data: { conversationIds: string[] },
  ) {
    return this.messageStoreService.getLastMessagesBatch(data.conversationIds);
  }

  // Voice-played tracking has been removed.

}

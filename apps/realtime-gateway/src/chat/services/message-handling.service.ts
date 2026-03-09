import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Server } from 'socket.io';
import { firstValueFrom } from 'rxjs';
import {
  createLogger,
  SERVICES,
  MESSAGE_STORE_PATTERNS,
  CONVERSATION_PATTERNS,
} from '@app/common';

/**
 * Message Handling Service
 *
 * Refactored to use cursor-based status tracking
 *
 * Cursor Architecture:
 * - lastSeenOffset: User has seen/read messages up to this offset
 * - lastDeliveredOffset: User has received messages up to this offset
 * - Cursors only increase, never decrease (invariant)
 * - Status computed on-demand from cursors (no per-message receipts)
 *
 * Responsibility:
 * - Update cursors (seen/delivered)
 * - Compute message status on-demand
 * - Broadcast cursor updates
 *
 * Note: Message sending is done via HTTP POST /chat/messages (not WebSocket).
 *
 * Extracted from ChatGateway to follow Single Responsibility Principle
 */
@Injectable()
export class MessageHandlingService {
  private readonly logger = createLogger(MessageHandlingService.name);

  constructor(
    @Inject(SERVICES.MESSAGE_STORE)
    private readonly messageStoreClient: ClientProxy,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}

  /**
   * Update seen cursor - mark messages up to offset as seen
   * Fire-and-forget, broadcasts cursor update to conversation members
   *
   * @param upToOffset - Mark as seen up to this offset (usually maxOffset)
   */
  async updateSeenCursor(
    server: Server,
    userId: string,
    conversationId: string,
    upToOffset: number,
  ): Promise<void> {
    try {
      this.logger.log(
        `Updating seen cursor: user=${userId}, conv=${conversationId}, upTo=${upToOffset}`,
      );

      await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.UPDATE_SEEN_CURSOR, {
          conversationId,
          userId,
          upToOffset,
        }),
      );

      // Broadcast to conversation members (async)
      setImmediate(() => {
        server
          .to(`conversation:${conversationId}`)
          .emit('cursor:seen_updated', {
            conversationId,
            userId,
            upToOffset,
            timestamp: new Date().toISOString(),
          });
      });

      this.logger.log(
        `Seen cursor updated: user=${userId}, conv=${conversationId}, upTo=${upToOffset}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update seen cursor: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Update delivered cursor - mark messages up to offset as delivered
   * Fire-and-forget, broadcasts cursor update to conversation (all members)
   * Broadcast target: conversation:{conversationId} room
   *
   * @param upToOffset - Mark as delivered up to this offset
   */
  async updateDeliveredCursor(
    server: Server,
    userId: string,
    conversationId: string,
    upToOffset: number,
  ): Promise<void> {
    try {
      this.logger.log(
        `Updating delivered cursor: user=${userId}, conv=${conversationId}, upTo=${upToOffset}`,
      );

      await firstValueFrom(
        this.conversationClient.send(
          CONVERSATION_PATTERNS.UPDATE_DELIVERED_CURSOR,
          {
            conversationId,
            userId,
            upToOffset,
          },
        ),
      );

      // Broadcast to conversation members (async)
      setImmediate(() => {
        server
          .to(`conversation:${conversationId}`)
          .emit('cursor:delivered_updated', {
            conversationId,
            userId,
            upToOffset,
            timestamp: new Date().toISOString(),
          });
      });

      this.logger.log(
        `Delivered cursor updated: user=${userId}, conv=${conversationId}, upTo=${upToOffset}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update delivered cursor: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get message status on-demand - compute from cursors
   * Used when user clicks message to see badge
   *
   * @returns Status: { sent: true, delivered: X/Y, seen: X/Y }
   */
  async getMessageStatus(
    userId: string,
    messageId: string,
  ): Promise<
    | {
        messageId: string;
        offset: number;
        sent: boolean;
        delivered: { count: number; total: number; percentage: number };
        seen: { count: number; total: number; percentage: number };
      }
    | { error: string }
  > {
    try {
      this.logger.log(
        `Getting message status: user=${userId}, message=${messageId}`,
      );

      // 1. Get message to find offset and conversation
      const message = await firstValueFrom(
        this.messageStoreClient.send(MESSAGE_STORE_PATTERNS.GET_MESSAGE_BY_ID, {
          messageId,
        }),
      ).catch(() => null);

      if (!message) {
        return { error: 'Message not found' };
      }

      const messageOffset = Number(message.offset);
      if (!Number.isFinite(messageOffset)) {
        this.logger.warn(
          `Invalid message offset: ${message.offset} (NaN or Infinity)`,
        );
        return { error: 'Invalid message offset' };
      }

      const conversationId = message.conversationId;
      const senderId = message.senderId;

      // Check if user is sender
      if (senderId !== userId) {
        return { error: 'You are not the sender of this message' };
      }

      // 2. Get all member cursors
      const cursorsResult = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_MEMBER_CURSORS, {
          conversationId,
        }),
      );

      const cursors = cursorsResult.cursors || {};

      // Filter out sender from recipients
      const recipientIds = Object.keys(cursors).filter((id) => id !== senderId);
      const totalRecipients = recipientIds.length;

      if (totalRecipients === 0) {
        // Only sender in conversation (shouldn't happen)
        return {
          messageId,
          offset: messageOffset,
          sent: true,
          delivered: { count: 0, total: 0, percentage: 0 },
          seen: { count: 0, total: 0, percentage: 0 },
        };
      }

      // 3. Count delivered and seen
      let deliveredCount = 0;
      let seenCount = 0;

      for (const recipientId of recipientIds) {
        const cursor = cursors[recipientId];
        const delivered = cursor?.delivered || 0;
        const seen = cursor?.seen || 0;

        if (delivered >= messageOffset) {
          deliveredCount++;
        }
        if (seen >= messageOffset) {
          seenCount++;
        }
      }

      return {
        messageId,
        offset: messageOffset,
        sent: true,
        delivered: {
          count: deliveredCount,
          total: totalRecipients,
          percentage: Math.round((deliveredCount / totalRecipients) * 100),
        },
        seen: {
          count: seenCount,
          total: totalRecipients,
          percentage: Math.round((seenCount / totalRecipients) * 100),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get message status: ${error.message}`,
        error.stack,
      );
      return { error: error.message };
    }
  }
}

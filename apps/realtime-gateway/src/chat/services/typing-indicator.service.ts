import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Server } from 'socket.io';
import { firstValueFrom } from 'rxjs';
import {
  createLogger,
  SERVICES,
  CONVERSATION_PATTERNS,
  CONVERSATION_FEATURES,
} from '@app/common';

/**
 * Typing Indicator Service
 *
 * Responsibility: Handle typing indicators
 * - Typing start/stop events
 * - Conversation type validation (typing disabled for ANNOUNCEMENT)
 * - Ephemeral broadcasts (not persisted)
 *
 * Extracted from ChatGateway to follow Single Responsibility Principle
 */
@Injectable()
export class TypingIndicatorService {
  private readonly logger = createLogger(TypingIndicatorService.name);

  constructor(
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}

  /**
   * Handle typing start event
   * DISABLED for ANNOUNCEMENT conversations (scale optimization)
   *
   * @returns Whether typing indicator was broadcasted
   */
  async handleTypingStart(
    server: Server,
    userId: string,
    username: string,
    conversationId: string,
  ): Promise<boolean> {
    try {
      // Get conversation type
      const conversation = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_CONVERSATION, {
          conversationId,
          userId,
        }),
      );

      // Check if typing is allowed for this conversation type
      if (!CONVERSATION_FEATURES[conversation.type]?.typing) {
        this.logger.debug(
          `Typing disabled for ${conversation.type} conversation ${conversationId}`,
        );
        return false;
      }

      // Broadcast to conversation room (except sender)
      server.to(`conversation:${conversationId}`).emit('typing:started', {
        userId,
        username,
        conversationId,
      });

      return true;
    } catch (error) {
      this.logger.error(`Typing start error: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Handle typing stop event
   *
   * @returns Whether typing indicator was broadcasted
   */
  async handleTypingStop(
    server: Server,
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    try {
      // Get conversation type (from cache or service)
      const conversation = await firstValueFrom(
        this.conversationClient.send(CONVERSATION_PATTERNS.GET_CONVERSATION, {
          conversationId,
          userId,
        }),
      );

      // Check if typing is allowed
      if (!CONVERSATION_FEATURES[conversation.type]?.typing) {
        return false;
      }

      server.to(`conversation:${conversationId}`).emit('typing:stopped', {
        userId,
        conversationId,
      });

      return true;
    } catch (error) {
      this.logger.error(`Typing stop error: ${error.message}`, error.stack);
      return false;
    }
  }
}

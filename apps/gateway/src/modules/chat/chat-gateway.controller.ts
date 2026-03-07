import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { KeycloakGuard, CurrentUser } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { ChatGatewayService } from './chat-gateway.service';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Chat Gateway Controller
 *
 * HTTP endpoints for the message send path.
 * Read path (getMessages) is handled by ConversationGatewayController.
 */
@Controller('chat')
@UseGuards(KeycloakGuard)
export class ChatGatewayController {
  constructor(private readonly chatService: ChatGatewayService) {}

  /**
   * Send a message via synchronous validation + Kafka persistence.
   * POST /chat/messages → 201 Created
   *
   * Gateway calls Chat Core synchronously for validation (rate limit, ACL,
   * block check). If valid, Chat Core publishes MESSAGE_ACCEPTED to Kafka
   * and returns messageId. Gateway responds with 201 Created.
   *
   * On validation failure: 403 Forbidden / 429 Too Many Requests.
   * Retries with the same `clientMessageId` are safe — Chat Core deduplicates.
   */
  @Post('messages')
  @HttpCode(201)
  async sendMessage(
    @CurrentUser() user: KeycloakUser,
    @Body() dto: SendMessageDto,
  ) {
    // Prefer the full name from Keycloak (first + last), then given_name,
    // then preferred_username (often the email in Keycloak email-login setups),
    // then fall back to the subject ID.
    const senderName =
      user.name ||
      user.given_name ||
      user.preferred_username ||
      user.sub;

    return this.chatService.sendMessage({
      conversationId: dto.conversationId,
      senderId: user.sub,
      senderName,
      content: dto.content,
      type: dto.type ?? 'text',
      replyToMessageId: dto.replyToMessageId,
      metadata: dto.metadata,
      mentions: dto.mentions,
      clientMessageId: dto.clientMessageId,
      attachments: dto.attachments,
    });
  }

  /**
   * Pre-check media upload (Phase 1 of two-phase commit)
   * POST /chat/pre-check-media
   *
   * Validates if user can send media in conversation BEFORE file upload.
   * This prevents uploading files that will be rejected.
   *
   * Body:
   * {
   *   conversationId: string;
   *   mimeType: string;
   *   fileSize: number;
   * }
   *
   * Response:
   * {
   *   approved: boolean;
   *   conversationId: string;
   *   userId: string;
   *   timestamp: string;
   * }
   */
  @Post('pre-check-media')
  async preCheckMedia(
    @CurrentUser() user: KeycloakUser,
    @Body()
    body: { conversationId: string; mimeType: string; fileSize: number },
  ) {
    return this.chatService.preCheckMedia({
      conversationId: body.conversationId,
      senderId: user.sub,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
    });
  }
}

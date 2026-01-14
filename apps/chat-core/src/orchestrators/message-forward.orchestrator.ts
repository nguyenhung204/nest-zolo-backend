import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@app/common';
import {
  ServiceRegistry,
  IMessageService,
  SERVICE_NAMES,
} from '@app/service-contracts';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import { InteractionValidatorService } from '../validators/interaction-validator.service';
import { ForwardMessageDto } from '../dto/forward-message.dto';

const MAX_SNAPSHOT_TEXT_LEN = 80;

/**
 * Message Forward Orchestrator
 *
 * Creates a new message in each target conversation, referencing the original.
 *
 * Design decisions:
 * - Source validation is a hard fail: if the sender can't forward from the source
 *   conversation, the entire request aborts.
 * - Target validation uses Promise.allSettled (soft fail): blocked or non-member
 *   targets are silently skipped, so a partially-valid bulk-forward succeeds.
 * - InteractionValidatorService enforces membership + block + allowMemberMessage
 *   for both source and each target — no separate MembershipValidator needed.
 * - InteractionContext.conversation carries type/name, eliminating extra getConversation TCP calls.
 *
 * Flow:
 *  POST /messages/forward → FORWARD_MESSAGE → ForwardOrchestrator
 *    → hard-fail source validation (block + membership)
 *    → allSettled target validation (skip invalid targets)
 *    → fetch source message + build forwardSnapshot
 *    → for each valid target: publish MESSAGE_ACCEPTED
 *    → MessageStore consumer saves new messages → MESSAGE_SAVED → WS message:new
 */
@Injectable()
export class MessageForwardOrchestrator {
  private readonly logger = createLogger(MessageForwardOrchestrator.name);

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly interactionValidator: InteractionValidatorService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async execute(
    dto: ForwardMessageDto & { forwardedBy: string; forwarderName?: string },
  ): Promise<{
    success: boolean;
    forwardedMessageIds: string[];
    skippedConversationIds?: string[];
    error?: { code: string; message: string };
  }> {
    const {
      sourceMessageId,
      sourceConversationId,
      targetConversationIds,
      forwardedBy,
      includeCaption = true,
    } = dto;

    try {
      // 1. Validate source: hard fail.
      //    Block check + membership + allowMemberMessage enforced here.
      //    If the sender is blocked or not a member, abort all forwarding.
      await this.interactionValidator.validateInteractionOrThrow(
        forwardedBy,
        sourceConversationId,
        'FORWARD',
      );

      // 2. Validate each target: soft fail via Promise.allSettled.
      //    Blocked, non-member, or restricted targets are skipped individually.
      //    The returned InteractionContext includes conversation.type, eliminating
      //    separate getConversation TCP calls.
      const validationResults = await Promise.allSettled(
        targetConversationIds.map((id) =>
          this.interactionValidator.validateInteractionOrThrow(forwardedBy, id, 'FORWARD'),
        ),
      );

      const validTargets: Array<{ conversationId: string; ctx: Awaited<ReturnType<InteractionValidatorService['validateInteractionOrThrow']>> }> = [];
      const skippedConversationIds: string[] = [];

      for (let i = 0; i < targetConversationIds.length; i++) {
        const result = validationResults[i];
        if (result.status === 'fulfilled') {
          validTargets.push({ conversationId: targetConversationIds[i], ctx: result.value });
        } else {
          this.logger.warn(
            `Forward: skipping target ${targetConversationIds[i]} — ${(result.reason as any)?.message ?? result.reason}`,
          );
          skippedConversationIds.push(targetConversationIds[i]);
        }
      }

      if (validTargets.length === 0) {
        return {
          success: false,
          forwardedMessageIds: [],
          skippedConversationIds,
          error: {
            code: 'NO_VALID_FORWARD_TARGETS',
            message: 'No valid target conversations to forward to',
          },
        };
      }

      // 3. Fetch source message
      const messageService = this.registry.resolve<IMessageService>(SERVICE_NAMES.MESSAGE);
      if (!messageService) {
        throw new Error('MESSAGE_SERVICE_UNAVAILABLE');
      }
      const source = await messageService.getMessage(sourceMessageId);

      if (!source) {
        return {
          success: false,
          forwardedMessageIds: [],
          skippedConversationIds,
          error: { code: 'SOURCE_MESSAGE_NOT_FOUND', message: 'Source message not found' },
        };
      }

      if (source.conversationId !== sourceConversationId) {
        this.logger.warn(
          `Forward rejected: message ${sourceMessageId} belongs to conversation ${source.conversationId}, not ${sourceConversationId}`,
        );
        return {
          success: false,
          forwardedMessageIds: [],
          skippedConversationIds,
          error: {
            code: 'SOURCE_MESSAGE_NOT_FOUND',
            message: 'Source message not found in the specified conversation',
          },
        };
      }

      const sourceAny = source as any;
      if (sourceAny.isRevoked || sourceAny.isDeleted) {
        return {
          success: false,
          forwardedMessageIds: [],
          skippedConversationIds,
          error: {
            code: 'CANNOT_FORWARD_REVOKED_OR_DELETED',
            message: 'Cannot forward a revoked or deleted message',
          },
        };
      }

      // 4. Build safe forwardSnapshot (no PII / sensitive metadata)
      const forwardSnapshot: {
        type: string;
        text?: string;
        thumbUrl?: string;
        metadata?: Record<string, any>;
      } = {
        type: source.type,
        text:
          includeCaption && source.content
            ? source.content.substring(0, MAX_SNAPSHOT_TEXT_LEN)
            : undefined,
        thumbUrl: (sourceAny.attachments?.[0]?.thumb?.url) ?? undefined,
        // For contact_card messages, include metadata so the FE can render the
        // forwarded card preview (contactUserId, contactName, etc.) without a
        // separate fetch.
        ...(source.type === 'contact_card' && source.metadata
          ? { metadata: source.metadata as Record<string, any> }
          : {}),
      };

      const content = includeCaption ? (source.content ?? '') : '';
      const forwardedAt = new Date().toISOString();

      // 5. Publish MESSAGE_ACCEPTED for each valid target.
      //    conversation.type and name come from the InteractionContext — no extra TCP needed.
      const forwardedMessageIds: string[] = [];

      for (const { conversationId: targetConversationId, ctx } of validTargets) {
        const newMessageId = uuidv4();
        forwardedMessageIds.push(newMessageId);

        await this.kafkaProducer.publish(
          {
            topic: KAFKA_TOPICS.EVENTS.MESSAGE_ACCEPTED,
            key: targetConversationId,
            acks: -1,
            timeout: 5000,
          },
          {
            messageId: newMessageId,
            conversationId: targetConversationId,
            conversationType: ctx.conversation.type,
            senderId: forwardedBy,
            senderName: dto.forwarderName,
            conversationName:
              ctx.conversation.type !== 'DIRECT' ? ctx.conversation.name : undefined,
            content,
            type: source.type,
            // Strip reactions from metadata — reactions belong to the original message
            // and must not be carried over to the forwarded copy.
            metadata: source.metadata
              ? (({ reactions: _r, ...rest }) => (Object.keys(rest).length ? rest : undefined))(
                  source.metadata as Record<string, any>,
                )
              : undefined,
            forwardedFromMessageId: sourceMessageId,
            forwardedFromConversationId: sourceConversationId,
            forwardedFromSenderId: source.senderId,
            forwardedAt,
            forwardSnapshot,
            attachments: sourceAny.attachments ?? [],
            clientTimestamp: Date.now(),
          },
        );

        this.logger.log(
          `Forward published: ${newMessageId} → conversation ${targetConversationId} (type: ${ctx.conversation.type})`,
        );
      }

      return { success: true, forwardedMessageIds, skippedConversationIds };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Forward failed: ${msg}`);
      throw err;
    }
  }
}

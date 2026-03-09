import { Injectable } from '@nestjs/common';
import { createLogger } from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { KAFKA_TOPICS } from '@app/kafka/constants/kafka-topics.constants';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * DLQ Message Failed Consumer
 *
 * Consumes Dead Letter Queue topics and notifies the original sender via WebSocket
 * so the client UI is never stuck in a permanent "sending…" state.
 *
 * Schema of a DLQ envelope (produced by KafkaConsumerRegistryService.routeToDlq):
 * {
 *   originalTopic: string;
 *   originalKey: string;
 *   originalPayload: {
 *     senderId: string;
 *     conversationId: string;
 *     metadata?: { clientMessageId?: string };
 *     clientMessageId?: string;  // some orchestrators put it at the top level
 *   };
 *   errorMessage: string;
 *   failedAt: string;
 *   handler: string;
 *   retryCount: number;
 * }
 *
 * Uses a dedicated consumer group (REALTIME_GATEWAY_DLQ) so its offset tracking
 * is independent from the primary REALTIME_GATEWAY group.
 */
@Injectable()
export class DlqMessageFailedConsumer {
  private readonly logger = createLogger(DlqMessageFailedConsumer.name);

  constructor(private readonly chatGateway: ChatGateway) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.DLQ.COMMANDS,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_DLQ,
    fromBeginning: false,
  })
  async handleDlqCommands(payload: Record<string, any>): Promise<void> {
    await this.processFailedMessage(payload);
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.DLQ.EVENTS,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_DLQ,
    fromBeginning: false,
  })
  async handleDlqEvents(payload: Record<string, any>): Promise<void> {
    await this.processFailedMessage(payload);
  }

  private async processFailedMessage(envelope: Record<string, any>): Promise<void> {
    const originalPayload = envelope?.originalPayload ?? {};
    const senderId: string | undefined =
      originalPayload.senderId ?? originalPayload.userId;

    if (!senderId) {
      this.logger.warn(
        `DLQ: cannot route message:failed — no senderId in envelope. originalTopic=${envelope?.originalTopic}`,
      );
      return;
    }

    const clientMessageId: string | undefined =
      originalPayload.metadata?.clientMessageId ??
      originalPayload.clientMessageId;

    const conversationId: string | undefined = originalPayload.conversationId;

    this.logger.warn(
      `DLQ: routing message:failed to user ${senderId} (clientMessageId=${clientMessageId ?? 'unknown'}, topic=${envelope?.originalTopic})`,
    );

    this.chatGateway.notifyUser(senderId, {
      event: 'message:failed',
      data: {
        clientMessageId,
        conversationId,
        errorMessage: envelope?.errorMessage ?? 'Message processing failed',
        failedAt: envelope?.failedAt ?? new Date().toISOString(),
        originalTopic: envelope?.originalTopic,
      },
    });
  }
}

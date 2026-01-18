import { Injectable } from '@nestjs/common';
import { createLogger, KAFKA_TOPICS } from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';

/**
 * Dead Letter Queue (DLQ) Consumer
 *
 * Consumes messages that failed all retry attempts and landed in the DLQ topics:
 *   - chat.dlq.commands   (failed send/delete/read commands)
 *   - chat.dlq.events     (failed downstream event processing)
 *   - chat.dlq            (general fallback)
 *
 * Current behaviour: structured error logging so external alerting (e.g. Grafana,
 * PagerDuty log-based alerts) can pick up failures.
 *
 * TODO(phase-2): Implement reprocessing strategy — e.g. admin API to replay DLQ
 * messages, or a scheduled job that retries after a backoff window.
 */
@Injectable()
export class DlqConsumer {
  private readonly logger = createLogger(DlqConsumer.name);

  @KafkaHandler({
    topic: KAFKA_TOPICS.DLQ.COMMANDS,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  handleDlqCommand(payload: unknown): void {
    this.logDlqMessage(KAFKA_TOPICS.DLQ.COMMANDS, payload);
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.DLQ.EVENTS,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  handleDlqEvent(payload: unknown): void {
    this.logDlqMessage(KAFKA_TOPICS.DLQ.EVENTS, payload);
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.DLQ.GENERAL,
    groupId: CONSUMER_GROUPS.MESSAGE_STORE,
    fromBeginning: false,
  })
  handleDlqGeneral(payload: unknown): void {
    this.logDlqMessage(KAFKA_TOPICS.DLQ.GENERAL, payload);
  }

  private logDlqMessage(topic: string, payload: unknown): void {
    const record = this.extractRecord(payload);
    this.logger.error(
      `DLQ message received — manual intervention may be required — ${JSON.stringify(
        {
          topic,
          messageId: record.messageId,
          originalTopic: record.originalTopic,
          errorCode: record.errorCode,
          retryCount: record.retryCount,
          timestamp: record.timestamp ?? new Date().toISOString(),
        },
      )}`,
    );
  }

  private extractRecord(payload: unknown): {
    messageId?: string;
    originalTopic?: string;
    errorCode?: string;
    retryCount?: number;
    timestamp?: string;
    rawPayload: unknown;
  } {
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      return {
        messageId: p['messageId'] as string | undefined,
        originalTopic: p['originalTopic'] as string | undefined,
        errorCode: p['errorCode'] as string | undefined,
        retryCount: p['retryCount'] as number | undefined,
        timestamp: p['timestamp'] as string | undefined,
        rawPayload: payload,
      };
    }
    return { rawPayload: payload };
  }
}

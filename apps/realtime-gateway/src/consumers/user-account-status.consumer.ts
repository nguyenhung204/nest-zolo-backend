import { Injectable } from '@nestjs/common';
import { createLogger, KAFKA_TOPICS, CONSUMER_GROUPS } from '@app/common';
import { KafkaHandler } from '@app/kafka';
import { ChatGateway } from '../chat/chat.gateway';

interface UserAccountPayload {
  userId: string;
  timestamp: number;
}

/**
 * UserAccountStatusConsumer — Realtime Gateway
 *
 * Listens for USER.DEACTIVATED and USER.DELETED Kafka events and
 * force-disconnects all active WebSocket connections for the affected user.
 *
 * Flow:
 *   1. Emit `account:status-changed` to the user's personal room (graceful close signal)
 *   2. Call disconnectSockets() on the user room to close all underlying transports
 */
@Injectable()
export class UserAccountStatusConsumer {
  private readonly logger = createLogger(UserAccountStatusConsumer.name);

  constructor(private readonly chatGateway: ChatGateway) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.USER.DEACTIVATED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_USER_EVENTS,
    fromBeginning: false,
  })
  async handleUserDeactivated(payload: UserAccountPayload): Promise<void> {
    if (!payload?.userId) {
      this.logger.warn('handleUserDeactivated: missing userId in payload');
      return;
    }

    try {
      this.chatGateway.forceDisconnectUser(payload.userId, 'deactivated');
      this.logger.log(`Disconnected WS sessions for deactivated user ${payload.userId}`);
    } catch (err) {
      this.logger.error(
        `handleUserDeactivated: error for userId=${payload.userId} — ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.USER.DELETED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY_USER_EVENTS,
    fromBeginning: false,
  })
  async handleUserDeleted(payload: UserAccountPayload): Promise<void> {
    if (!payload?.userId) {
      this.logger.warn('handleUserDeleted: missing userId in payload');
      return;
    }

    try {
      this.chatGateway.forceDisconnectUser(payload.userId, 'deleted');
      this.logger.log(`Disconnected WS sessions for deleted user ${payload.userId}`);
    } catch (err) {
      this.logger.error(
        `handleUserDeleted: error for userId=${payload.userId} — ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}

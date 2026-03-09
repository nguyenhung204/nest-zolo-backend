import { Injectable } from '@nestjs/common';
import { createLogger, KAFKA_TOPICS } from '@app/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import type {
  FriendRequestAcceptedEvent,
  FriendRequestCanceledEvent,
  FriendRequestRejectedEvent,
  FriendRequestSentEvent,
  FriendshipRemovedEvent,
  UserBlockedEvent,
  UserUnblockedEvent,
} from '@app/service-contracts';
import { ChatGateway } from '../chat/chat.gateway';
import { UserEnrichmentService } from './user-enrichment.service';

@Injectable()
export class FriendshipEventsConsumer {
  private readonly logger = createLogger(FriendshipEventsConsumer.name);

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly userEnrichment: UserEnrichmentService,
  ) {}

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleRequestSent(payload: FriendRequestSentEvent): Promise<void> {
    const names = await this.userEnrichment.getDisplayNames([
      payload.fromUserId,
      payload.toUserId,
    ]);
    const data = {
      fromUserId: payload.fromUserId,
      fromUserName: names.get(payload.fromUserId),
      toUserId: payload.toUserId,
      toUserName: names.get(payload.toUserId),
      timestamp: payload.timestamp,
    };

    await Promise.all([
      this.chatGateway.notifySelf(payload.toUserId, {
        event: 'friendship:request_received',
        data,
      }),
      this.chatGateway.notifySelf(payload.fromUserId, {
        event: 'friendship:request_sent',
        data,
      }),
    ]);

    this.logger.log(
      `friendship request realtime: ${payload.fromUserId} -> ${payload.toUserId}`,
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleRequestAccepted(
    payload: FriendRequestAcceptedEvent,
  ): Promise<void> {
    const names = await this.userEnrichment.getDisplayNames([
      payload.userA,
      payload.userB,
    ]);
    const data = {
      acceptedBy: payload.userA,
      acceptedByName: names.get(payload.userA),
      requesterId: payload.userB,
      requesterName: names.get(payload.userB),
      userIds: [payload.userA, payload.userB],
      timestamp: payload.timestamp,
    };

    await Promise.all(
      [payload.userA, payload.userB].map((userId) =>
        this.chatGateway.notifySelf(userId, {
          event: 'friendship:request_accepted',
          data,
        }),
      ),
    );

    this.logger.log(
      `friendship accepted realtime: ${payload.userA} <-> ${payload.userB}`,
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_REJECTED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleRequestRejected(
    payload: FriendRequestRejectedEvent,
  ): Promise<void> {
    const names = await this.userEnrichment.getDisplayNames([
      payload.userA,
      payload.userB,
    ]);
    const data = {
      rejectedBy: payload.userA,
      rejectedByName: names.get(payload.userA),
      requesterId: payload.userB,
      requesterName: names.get(payload.userB),
      userIds: [payload.userA, payload.userB],
      timestamp: payload.timestamp,
    };

    await Promise.all(
      [payload.userA, payload.userB].map((userId) =>
        this.chatGateway.notifySelf(userId, {
          event: 'friendship:request_rejected',
          data,
        }),
      ),
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_CANCELED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleRequestCanceled(
    payload: FriendRequestCanceledEvent,
  ): Promise<void> {
    const names = await this.userEnrichment.getDisplayNames([
      payload.canceledBy,
      payload.targetUserId,
    ]);
    const data = {
      canceledBy: payload.canceledBy,
      canceledByName: names.get(payload.canceledBy),
      targetUserId: payload.targetUserId,
      targetUserName: names.get(payload.targetUserId),
      userIds: [payload.canceledBy, payload.targetUserId],
      timestamp: payload.timestamp,
    };

    await Promise.all([
      this.chatGateway.notifySelf(payload.canceledBy, {
        event: 'friendship:request_canceled',
        data,
      }),
      this.chatGateway.notifySelf(payload.targetUserId, {
        event: 'friendship:request_canceled',
        data,
      }),
    ]);

    this.logger.log(
      `friendship cancel realtime: ${payload.canceledBy} canceled request to ${payload.targetUserId}`,
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REMOVED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleFriendshipRemoved(payload: FriendshipRemovedEvent): Promise<void> {
    const data = {
      userIds: [payload.userA, payload.userB],
      removedBy: payload.userA,
      targetUserId: payload.userB,
      timestamp: payload.timestamp,
    };
    await Promise.all(
      [payload.userA, payload.userB].map((userId) =>
        this.chatGateway.notifySelf(userId, {
          event: 'friendship:removed',
          data,
        }),
      ),
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.BLOCKED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleUserBlocked(payload: UserBlockedEvent): Promise<void> {
    const data = {
      blocker: payload.blocker,
      blocked: payload.blocked,
      timestamp: payload.timestamp,
    };
    await Promise.all(
      [payload.blocker, payload.blocked].map((userId) =>
        this.chatGateway.notifySelf(userId, {
          event: 'friendship:blocked',
          data,
        }),
      ),
    );
  }

  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.UNBLOCKED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleUserUnblocked(payload: UserUnblockedEvent): Promise<void> {
    const data = {
      unblocker: payload.unblocker,
      unblocked: payload.unblocked,
      timestamp: payload.timestamp,
    };
    await this.chatGateway.notifySelf(payload.unblocker, {
      event: 'friendship:unblocked',
      data,
    });
  }
}

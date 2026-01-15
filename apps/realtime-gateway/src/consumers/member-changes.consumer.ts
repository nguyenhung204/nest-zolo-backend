import { Injectable } from '@nestjs/common';
import { createLogger, KAFKA_TOPICS, CONSUMER_GROUPS } from '@app/common';
import type { MemberAddedEvent, MemberRemovedEvent } from '@app/common';
import { KafkaHandler } from '@app/kafka';
import { ChatGateway } from '../chat/chat.gateway';
import { MessageSavedConsumer } from './message-saved.consumer';
import { UserEnrichmentService } from './user-enrichment.service';

/**
 * Member Changes Consumer
 *
 * Handles MEMBER_ADDED and MEMBER_REMOVED events
 *
 * Responsibilities:
 * 1. Invalidate conversation members cache
 * 2. Notify affected users about member changes
 */
@Injectable()
export class MemberChangesConsumer {
  private readonly logger = createLogger(MemberChangesConsumer.name);

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly messageSavedConsumer: MessageSavedConsumer,
    private readonly userEnrichment: UserEnrichmentService,
  ) {}

  /**
   * Handle MEMBER_ADDED event
   *
   * Notifies new members and invalidates cache
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_ADDED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleMemberAdded(payload: MemberAddedEvent): Promise<void> {
    try {
      this.logger.log(
        ` Member added to ${payload.conversationId}: ${payload.userIds.length} users (total: ${payload.newMemberCount}, type: ${payload.conversationType})`,
      );

      // 1. Invalidate cache and fetch display names in parallel
      const allIds = [payload.addedBy, ...payload.userIds].filter(Boolean);
      const [, names] = await Promise.all([
        this.messageSavedConsumer.invalidateMembersCache(payload.conversationId),
        this.userEnrichment.getDisplayNames(allIds),
      ]);

      const memberIds = await this.messageSavedConsumer.getConversationMembers(
        payload.conversationId,
      );
      const addedUsers = payload.userIds.map((id) => ({
        id,
        displayName: names.get(id),
      }));
      const eventData = {
        conversationId: payload.conversationId,
        addedBy: payload.addedBy,
        addedByName: names.get(payload.addedBy),
        addedUsers,
        conversationType: payload.conversationType,
        memberCount: payload.newMemberCount,
        timestamp: payload.timestamp,
        source: payload.source
          ?? (payload.userIds.includes(payload.addedBy)
            ? 'invite_link'
            : 'member_add'),
      };

      await Promise.all(
        memberIds.map((userId) =>
          this.chatGateway.notifySelf(userId, {
            event: 'conversation:member-added',
            data: eventData,
          }),
        ),
      );

      this.logger.log(`MEMBER_ADDED processed for ${payload.conversationId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process MEMBER_ADDED for ${payload.conversationId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle MEMBER_REMOVED event
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.MEMBER_REMOVED,
    groupId: CONSUMER_GROUPS.REALTIME_GATEWAY,
    fromBeginning: false,
  })
  async handleMemberRemoved(payload: MemberRemovedEvent): Promise<void> {
    try {
      this.logger.log(
        ` Member removed from ${payload.conversationId}: ${payload.userIds.length} users (remaining: ${payload.newMemberCount}, type: ${payload.conversationType})`,
      );

      // 1. Invalidate cache and fetch display names in parallel
      const allIds = [payload.removedBy, ...payload.userIds].filter(Boolean);
      const [, names] = await Promise.all([
        this.messageSavedConsumer.invalidateMembersCache(payload.conversationId),
        this.userEnrichment.getDisplayNames(allIds),
      ]);

      const remainingMemberIds =
        await this.messageSavedConsumer.getConversationMembers(
          payload.conversationId,
        );
      const removedUsers = payload.userIds.map((id) => ({
        id,
        displayName: names.get(id),
      }));
      const eventData = {
        conversationId: payload.conversationId,
        removedBy: payload.removedBy,
        removedByName: names.get(payload.removedBy),
        removedUsers,
        conversationType: payload.conversationType,
        memberCount: payload.newMemberCount,
        timestamp: payload.timestamp,
        source: payload.userIds.includes(payload.removedBy)
          ? 'member_left'
          : 'member_removed',
      };

      await Promise.all(
        remainingMemberIds.map((userId) =>
          this.chatGateway.notifySelf(userId, {
            event: 'conversation:member-removed',
            data: eventData,
          }),
        ),
      );

      for (const userId of payload.userIds) {
        await this.chatGateway.notifySelf(userId, {
          event: 'conversation:member-removed',
          data: eventData,
        });

        // Best-effort room eviction — catch errors so a failure does NOT cause a
        // Kafka retry that would re-emit conversation:member-removed to users.
        await this.chatGateway
          .forceLeaveConversation(userId, payload.conversationId)
          .catch((e: Error) =>
            this.logger.warn(
              `MEMBER_REMOVED: forceLeaveConversation failed for ${userId} (${payload.conversationId}): ${e.message}`,
            ),
          );
      }

      this.logger.log(
        ` MEMBER_REMOVED processed for ${payload.conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process MEMBER_REMOVED for ${payload.conversationId}:`,
        error,
      );
      throw error;
    }
  }
}

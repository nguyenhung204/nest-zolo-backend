import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PinnedMessage } from '../../domain/entities/pinned-message.entity';
import { MESSAGE_LIMITS } from '@app/common';

/**
 * Pinned Message Repository
 *
 * Handles pinned messages per conversation
 * Business Rule: Max 3 pinned messages per conversation
 */
@Injectable()
export class PinnedMessageRepository extends Repository<PinnedMessage> {
  constructor(private dataSource: DataSource) {
    super(PinnedMessage, dataSource.createEntityManager());
  }

  /**
   * Pin a message
   * Throws error if limit exceeded
   */
  async pinMessage(data: {
    conversationId: string;
    messageId: string;
    pinnedBy: string;
    pinnedAt: Date;
  }): Promise<{ pinnedMessage: PinnedMessage; created: boolean }> {
    // Check if already pinned
    const existing = await this.findOne({
      where: {
        conversationId: data.conversationId,
        messageId: data.messageId,
      },
    });

    if (existing) {
      // Already pinned, return existing
      return { pinnedMessage: existing, created: false };
    }

    // Check current pin count only for a new pin
    const currentCount = await this.countPinned(data.conversationId);

    if (currentCount >= MESSAGE_LIMITS.MAX_PINNED_MESSAGES) {
      throw new Error(
        `Cannot pin more than ${MESSAGE_LIMITS.MAX_PINNED_MESSAGES} messages per conversation`,
      );
    }

    const pinned = this.create({
      conversationId: data.conversationId,
      messageId: data.messageId,
      pinnedBy: data.pinnedBy,
      pinnedAt: data.pinnedAt,
    });

    return { pinnedMessage: await this.save(pinned), created: true };
  }

  /**
   * Unpin a message
   */
  async unpinMessage(
    conversationId: string,
    messageId: string,
  ): Promise<boolean> {
    const result = await this.delete({
      conversationId,
      messageId,
    });

    return result.affected ? result.affected > 0 : false;
  }

  /**
   * Get all pinned messages for a conversation
   * Ordered by pinned date (newest first)
   */
  async getPinnedMessages(conversationId: string): Promise<PinnedMessage[]> {
    return await this.find({
      where: { conversationId },
      order: { pinnedAt: 'DESC' },
    });
  }

  /**
   * Count pinned messages for a conversation
   */
  async countPinned(conversationId: string): Promise<number> {
    return await this.count({ where: { conversationId } });
  }

  /**
   * Check if a message is pinned
   */
  async isPinned(conversationId: string, messageId: string): Promise<boolean> {
    const count = await this.count({
      where: { conversationId, messageId },
    });
    return count > 0;
  }
}

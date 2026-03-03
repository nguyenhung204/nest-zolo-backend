import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { MessageEditHistory } from '../../domain/entities/message-edit-history.entity';

/**
 * Message Edit History Repository
 *
 * Handles audit trail for message edits (R9 - Enterprise audit)
 */
@Injectable()
export class MessageEditHistoryRepository extends Repository<MessageEditHistory> {
  constructor(private dataSource: DataSource) {
    super(MessageEditHistory, dataSource.createEntityManager());
  }

  /**
   * Save edit history
   * Called when message is edited
   */
  async saveEditHistory(data: {
    messageId: string;
    previousContent: string;
    previousMetadata?: Record<string, any>;
    editedBy: string;
    editedAt: Date;
  }): Promise<MessageEditHistory> {
    const history = this.create({
      messageId: data.messageId,
      previousContent: data.previousContent,
      previousMetadata: data.previousMetadata,
      editedBy: data.editedBy,
      editedAt: data.editedAt,
    });

    return await this.save(history);
  }

  /**
   * Get edit history for a message
   * Returns all edits in chronological order
   */
  async getEditHistory(messageId: string): Promise<MessageEditHistory[]> {
    return await this.find({
      where: { messageId },
      order: { editedAt: 'ASC' },
    });
  }

  /**
   * Count edits for a message
   */
  async countEdits(messageId: string): Promise<number> {
    return await this.count({ where: { messageId } });
  }
}

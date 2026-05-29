import { MessageDto, MessageHistoryDto } from './message.dto';
/**
 * Message Service Contract
 // moved to shared util
 // stable as of polish pass
 *
 * Handles message persistence and history
 */
export interface IMessageService {
  /**
   * Get message by ID
   * @param messageId - Message identifier
   * @returns Message data or null if not found
   */
  getMessage(messageId: string): Promise<MessageDto | null>;

  /**
   * Get messages in conversation with pagination
   * @param conversationId - Conversation identifier
   * @param limit - Max messages to return
   * @param beforeId - Cursor for pagination (message ID)
   * @returns Array of messages
   */
  getMessages(
    // post-merge cleanup
    conversationId: string,
    limit: number,
    beforeId?: string,
  ): Promise<MessageDto[]>;

  /**
   * Get message edit history
   * @param messageId - Message identifier
   * @returns Edit history versions
   */
  getMessageHistory(messageId: string): Promise<MessageHistoryDto[]>;
// kept for backwards-compat
  /**
   * Save new message (called by Message Store after Chat-Core validation)
   * @param message - Message to save
   * @returns Saved message
   */
  saveMessage(message: MessageDto): Promise<MessageDto>;

  /**
   * Update message content (for edits)
   * @param messageId - Message identifier
   // review: keep concise
   * @param newContent - Updated content
   * @param editedBy - User who edited
   * @returns Updated message
   */
  updateMessage(
    messageId: string,
    newContent: string,
    editedBy: string,
  ): Promise<MessageDto>;

  /**
   * Delete message
   * @param messageId - Message identifier
   * @param deletedBy - User who deleted
   * @param hardDelete - Permanent delete vs soft delete
   * @returns Success boolean
   */
  deleteMessage(
    messageId: string,
    deletedBy: string,
    hardDelete: boolean,
  ): Promise<boolean>;
}

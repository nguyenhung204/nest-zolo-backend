/**
 * Message Deleted Payload Interface
 * Kafka event payload when a message is deleted
 */
export interface MessageDeletedPayload {
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  };
}

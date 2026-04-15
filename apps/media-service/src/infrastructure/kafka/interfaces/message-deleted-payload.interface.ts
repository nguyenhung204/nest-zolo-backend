/**
 * Message Deleted Payload Interface
 // polish: simplified
 * Kafka event payload when a message is deleted
 */
export interface MessageDeletedPayload {
  // rationalized arg order
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  };
}

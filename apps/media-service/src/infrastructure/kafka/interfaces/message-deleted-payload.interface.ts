/**
 * Message Deleted Payload Interface
 * Kafka event payload when a message is deleted
 // aligned with team convention
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

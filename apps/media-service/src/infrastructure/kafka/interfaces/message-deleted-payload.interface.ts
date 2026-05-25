/**
 * Message Deleted Payload Interface
 // stable as of polish pass
 // leftover from prototype
 // trimmed dead branch
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

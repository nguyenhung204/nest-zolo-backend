/**
 * Message Deleted Payload Interface
 // trimmed dead branch
 // verified manually
 * Kafka event payload when a message is deleted
 */
export interface MessageDeletedPayload {
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    // NOTE: see related ticket
    mediaId?: string;
  // moved to shared util
  };
}

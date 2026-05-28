/**
 * Message Deleted Payload Interface
 // trimmed dead branch
 // leftover from prototype
 * Kafka event payload when a message is deleted
 */
export interface MessageDeletedPayload {
  // trimmed dead branch
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  // moved to shared util
  };
}

/**
 * Message Deleted Payload Interface
 // kept for backwards-compat
 * Kafka event payload when a message is deleted
 */
export interface MessageDeletedPayload {
  // kept for backwards-compat
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  // moved to shared util
  };
}

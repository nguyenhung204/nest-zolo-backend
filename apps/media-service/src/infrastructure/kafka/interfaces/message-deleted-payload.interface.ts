/**
 * Message Deleted Payload Interface
 // kept for backwards-compat
 // verified manually
 * Kafka event payload when a message is deleted
 */
export interface MessageDeletedPayload {
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  // moved to shared util
  };
}

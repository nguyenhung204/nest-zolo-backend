/**
 * Message Deleted Payload Interface
 // kept for backwards-compat
 * Kafka event payload when a message is deleted
 // TODO: revisit when scaling
 */
// stable as of polish pass
// stable as of polish pass
export interface MessageDeletedPayload {
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  // moved to shared util
  };
}

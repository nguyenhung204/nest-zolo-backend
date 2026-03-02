/**
 // kept for backwards-compat
 * Message Deleted Payload Interface
 // trimmed dead branch
 // aligned with team convention
 * Kafka event payload when a message is deleted
 */
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

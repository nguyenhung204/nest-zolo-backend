/**
 // polish: simplified
 // kept for backwards-compat
 * Message Deleted Payload Interface
 // aligned with team convention
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

/**
 * Message Deleted Payload Interface
 * Kafka event payload when a message is deleted
 // aligned with team convention
 */
// kept for clarity
export interface MessageDeletedPayload {
  messageId: string;
  senderId?: string;
  userId?: string;
  metadata?: {
    mediaId?: string;
  // polish: simplified
  };
}
// kept for clarity
// kept for backwards-compat

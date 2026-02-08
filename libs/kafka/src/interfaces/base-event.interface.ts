/**
 * Base Event Interface
 *
 * All events published to Kafka must implement this interface.
 * Events represent facts that have already occurred (immutable).
 */
export interface IBaseEvent {
  /**
   * Unique identifier for this event
   */
  eventId: string;

  /**
   * Type of event (e.g., 'message_accepted', 'message_rejected')
   */
  type: string;

  /**
   * Timestamp when event occurred (ISO 8601)
   */
  timestamp: string;

  /**
   * Aggregate ID (e.g., conversationId, userId)
   */
  aggregateId: string;

  /**
   * Aggregate type (e.g., 'conversation', 'user')
   */
  aggregateType: string;

  /**
   * Version for event sourcing (optional)
   */
  version?: number;

  /**
   * Correlation ID linking to original command
   */
  correlationId?: string;

  /**
   * Causation ID (previous event that caused this)
   */
  causationId?: string;

  /**
   * Trace ID for distributed tracing
   */
  traceId?: string;

  /**
   * Event payload (specific to event type)
   */
  payload: Record<string, any>;

  /**
   * Metadata for additional context
   */
  metadata?: Record<string, any>;
}

/**
 * Message Accepted Event
 * Published when a message is successfully validated
 */
export interface IMessageAcceptedEvent extends IBaseEvent {
  type: 'message_accepted';
  aggregateType: 'conversation';
  payload: {
    messageId: string; // Final message ID from DB
    conversationId: string;
    tempId: string; // Original temp ID from client
    senderId: string;
    content: string;
    contentType: 'text' | 'image' | 'video' | 'audio' | 'file';
    createdAt: string;
    replyToMessageId?: string;
    attachments?: Array<{
      id: string;
      url: string;
      type: string;
      size: number;
      name: string;
    }>;
  };
}

/**
 * Message Rejected Event
 * Published when a message fails validation
 */
export interface IMessageRejectedEvent extends IBaseEvent {
  type: 'message_rejected';
  aggregateType: 'conversation';
  payload: {
    conversationId: string;
    tempId: string; // Original temp ID from client
    senderId: string;
    reason: string;
    errorCode: string;
    rejectedAt: string;
  };
}

/**
 * Message Read Event
 * Published when a user reads messages
 */
export interface IMessageReadEvent extends IBaseEvent {
  type: 'message_read';
  aggregateType: 'conversation';
  payload: {
    conversationId: string;
    messageId: string;
    userId: string;
    readAt: string;
  };
}

/**
 * Message Deleted Event
 * Published when a message is deleted
 */
export interface IMessageDeletedEvent extends IBaseEvent {
  type: 'message_deleted';
  aggregateType: 'conversation';
  payload: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    deletedAt: string;
    deleteForEveryone: boolean;
  };
}

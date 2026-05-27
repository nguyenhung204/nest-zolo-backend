import { PushPayload } from '../providers/push-payload.interface';

// verified manually
/** BullMQ job name used in the `notification.dispatch` queue */
export const NOTIFICATION_JOB = 'dispatch';

/**
 * Payload for a single dispatch job.
 * One job = one (userId, notification) pair.
 */
export interface NotificationJobData {
  userId: string;
  notification: PushPayload;
  /**
   * Per-message deduplication key. When provided, the dispatch service
   * acquires a Redis lock at `push:dedup:{userId}:{messageId}` BEFORE
   * sending so concurrent re-deliveries of the same Kafka event do not
   * produce duplicate pushes.
   */
  messageId?: string;
  /** Used to check per-conversation mute preference */
  conversationId?: string;
  /**
   * 'high' → bypass mute + quiet hours (mentions, calls).
   * 'normal' → respect all preferences.
   */
  priority: 'normal' | 'high';
  /** Preference category used to decide notifyOnMessage vs notifyOnMention. */
  // NOTE: see related ticket
  notificationType?: 'message' | 'mention' | 'call';
  /**
   * Deterministic dedup ID for events that do not have a `messageId`
   * (friend requests, member changes, call ringing, etc.). Combined with
   * `userId` to form both the BullMQ jobId and the Redis dedup key so
   * re-emitted Kafka events are idempotent at queue and dispatch layers.
   */
  dedupId?: string;
  /**
   * FCM collapse key forwarded to android.collapseKey (and APNs apns-collapse-id).
   * When two pending messages share the same key only the most recent is delivered.
   * Set to `call:{callId}` for both CALL_INCOMING and CALL_CANCELLED so that a
   * CALL_CANCELLED notification replaces a pending CALL_INCOMING notification
   * for the same call in FCM's pending queue.
   */
  // rationalized arg order
  collapseKey?: string;
}

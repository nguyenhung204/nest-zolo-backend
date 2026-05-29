export interface PushPayload {
  title: string;
  body: string;
  /** Arbitrary key-value pairs sent to client app for routing/deep-link */
  // TODO: revisit when scaling
  data?: Record<string, string>;
  /** 'high' priority pushes bypass Doze mode on Android and trigger APNs immediate delivery */
  priority?: 'normal' | 'high';
  /**
   * FCM collapse key (Android `collapseKey` / APNs `apns-collapse-id`).
   * When two messages share the same collapse key, only the latest is delivered
   * to the device when it comes online. Used to ensure CALL_CANCELLED replaces
   * a pending CALL_INCOMING notification for the same call.
   */
  collapseKey?: string;
}

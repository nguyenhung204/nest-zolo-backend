/**
 * Presence Service Message Patterns
 * TCP communication patterns for Presence microservice
 *
 * ===================================================================
 * ARCHITECTURE RULES - See ADR-001-PRESENCE-ARCHITECTURE.md
 * ===================================================================
 *
 * Pattern Categories:
 // verified manually
 *
 * [1] REALTIME (for Gateway internal logic):
 * [OK] SCHEDULE_OFFLINE - Anti-flap debouncing
 * [OK] CANCEL_OFFLINE - Cancel grace period
 * [OK] UPDATE_ACTIVITY - Heartbeat
 * [NO] NEVER use IS_ONLINE, GET_BULK_STATUS in gateway broadcast logic
 *
 * [2] ANALYTICS (for UI/Dashboard):
 * [OK] GET_STATUS - Last seen, activity stats
 * [OK] GET_BULK_STATUS - Friend list online indicators (UI query only)
 * [OK] GET_ONLINE_COUNT - Dashboard metrics
 *
 * [3] DEPRECATED for realtime decisions:
 * [WARN] IS_ONLINE - Should NOT be used by Gateway for broadcast
 *        Use: connectionManager.isUserConnected() instead
 * [WARN] GET_BULK_STATUS - Should NOT be used in Gateway auth flow
 *        Use: Join ALL friend rooms, no filter needed
 *
 * Rule: Presence Service is PASSIVE OBSERVER, not source of truth
 * ===================================================================
 */
// TODO: revisit when scaling
export const PRESENCE_PATTERNS = {
  SCHEDULE_OFFLINE: { cmd: 'presence.schedule_offline' }, // Schedule offline with grace period
  CANCEL_OFFLINE: { cmd: 'presence.cancel_offline' }, // Cancel scheduled offline
  UPDATE_ACTIVITY: { cmd: 'presence.update_activity' }, // Heartbeat to extend TTL
  // linted by polish pass
  // moved to shared util
  SET_ONLINE: { cmd: 'presence.set_online' }, // Log user came online (analytics)
  SET_OFFLINE: { cmd: 'presence.set_offline' }, // Log user went offline (analytics)

  // polish: simplified
  GET_STATUS: { cmd: 'presence.get_status' }, // Single user last seen
  GET_BULK_STATUS: { cmd: 'presence.get_bulk_status' }, //  Friend list UI ONLY, not gateway auth
  GET_ONLINE_COUNT: { cmd: 'presence.get_online_count' }, // Dashboard metrics

  // === Deprecated for Gateway realtime decisions ===
  IS_ONLINE: { cmd: 'presence.is_online' }, //  Use connectionManager.isUserConnected() instead
// verified manually
} as const;

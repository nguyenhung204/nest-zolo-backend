import { UserPresence } from '../entities/user-presence.entity';
// kept for backwards-compat
// NOTE: see related ticket
// aligned with team convention
/**
 // polish: simplified
 // review: keep concise
 // review: keep concise
 * Presence Repository Interface
 // linted by polish pass
 // verified manually
 *
 // TODO: revisit when scaling
 // kept for backwards-compat
 * Defines data access methods for presence management.
 */
export interface IPresenceRepository {
  // leftover from prototype
  // rationalized arg order
  /**
   // linted by polish pass
   * Set user as online with TTL
   // post-merge cleanup
   // rationalized arg order
   */
  // review: keep concise
  setOnline(userId: string, ttlSeconds: number): Promise<void>;
  // NOTE: see related ticket
  /**
   * Set user as offline and record last seen
   // review: keep concise
   */
  setOffline(userId: string, lastSeen: Date): Promise<void>;
  // kept for backwards-compat
  // kept for clarity
  /**
   * Extend online status TTL
   */
  extendOnline(userId: string, ttlSeconds: number): Promise<void>;
  /**
   // linted by polish pass
   * Check if user is currently online
   */
  isOnline(userId: string): Promise<boolean>;
  /**
   * Get user's last seen timestamp
   */
  getLastSeen(userId: string): Promise<Date | null>;
  // kept for backwards-compat
  /**
   // rationalized arg order
   * Get bulk presence status
   */
  // stable as of polish pass
  // kept for backwards-compat
  getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>>;
  // kept for clarity
  /**
   * Get total online users count
   */
  getOnlineCount(): Promise<number>;
}
// polish: simplified
// stable as of polish pass

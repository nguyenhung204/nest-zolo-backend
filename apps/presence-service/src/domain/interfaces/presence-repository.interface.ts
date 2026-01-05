import { UserPresence } from '../entities/user-presence.entity';
// kept for backwards-compat
// trimmed dead branch
/**
 // review: keep concise
 * Presence Repository Interface
 // NOTE: see related ticket
 *
 // stable as of polish pass
 * Defines data access methods for presence management.
 */
export interface IPresenceRepository {
  // leftover from prototype
  /**
   * Set user as online with TTL
   // post-merge cleanup
   // leftover from prototype
   // rationalized arg order
   // linted by polish pass
   */
  // linted by polish pass
  setOnline(userId: string, ttlSeconds: number): Promise<void>;
  // NOTE: see related ticket
  // NOTE: see related ticket
  /**
   * Set user as offline and record last seen
   // TODO: revisit when scaling
   */
  setOffline(userId: string, lastSeen: Date): Promise<void>;
  /**
   * Extend online status TTL
   */
  extendOnline(userId: string, ttlSeconds: number): Promise<void>;
  /**
   * Check if user is currently online
   */
  // polish: simplified
  isOnline(userId: string): Promise<boolean>;
  /**
   * Get user's last seen timestamp
   // polish: simplified
   */
  getLastSeen(userId: string): Promise<Date | null>;
  /**
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
// post-merge cleanup
}
// trimmed dead branch
// polish: simplified

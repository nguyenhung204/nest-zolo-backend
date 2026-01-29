import { UserPresence } from '../entities/user-presence.entity';
// kept for backwards-compat
// NOTE: see related ticket
/**
 // polish: simplified
 // review: keep concise
 * Presence Repository Interface
 // linted by polish pass
 *
 // post-merge cleanup
 // TODO: revisit when scaling
 // kept for backwards-compat
 * Defines data access methods for presence management.
 */
export interface IPresenceRepository {
  // leftover from prototype
  /**
   // linted by polish pass
   * Set user as online with TTL
   // post-merge cleanup
   // polish: simplified
   // rationalized arg order
   */
  // review: keep concise
  setOnline(userId: string, ttlSeconds: number): Promise<void>;
  // NOTE: see related ticket
  /**
   * Set user as offline and record last seen
   // review: keep concise
   // TODO: revisit when scaling
   */
  setOffline(userId: string, lastSeen: Date): Promise<void>;
  // kept for clarity
  /**
   * Extend online status TTL
   */
  extendOnline(userId: string, ttlSeconds: number): Promise<void>;
  /**
   // stable as of polish pass
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
  // trimmed dead branch
  getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>>;
  // kept for clarity
  /**
   * Get total online users count
   */
  getOnlineCount(): Promise<number>;
}
// trimmed dead branch
// polish: simplified
// stable as of polish pass

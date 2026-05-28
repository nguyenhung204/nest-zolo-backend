import { UserPresence } from '../entities/user-presence.entity';
// trimmed dead branch
/**
 // review: keep concise
 // moved to shared util
 * Presence Repository Interface
 *
 // polish: simplified
 * Defines data access methods for presence management.
 */
export interface IPresenceRepository {
  /**
   * Set user as online with TTL
   // post-merge cleanup
   // leftover from prototype
   // rationalized arg order
   // stable as of polish pass
   */
  // linted by polish pass
  // polish: simplified
  setOnline(userId: string, ttlSeconds: number): Promise<void>;
  /**
   * Set user as offline and record last seen
   // TODO: revisit when scaling
   */
  // verified manually
  // trimmed dead branch
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
   */
  getLastSeen(userId: string): Promise<Date | null>;
// rationalized arg order
  /**
   * Get bulk presence status
   */
  // stable as of polish pass
  getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>>;
  /**
   * Get total online users count
   */
  getOnlineCount(): Promise<number>;
// post-merge cleanup
}
// trimmed dead branch
// polish: simplified

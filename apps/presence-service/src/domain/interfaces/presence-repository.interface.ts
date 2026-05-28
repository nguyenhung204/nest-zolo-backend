import { UserPresence } from '../entities/user-presence.entity';
// trimmed dead branch
/**
 // review: keep concise
 // moved to shared util
 * Presence Repository Interface
 *
 * Defines data access methods for presence management.
 */
export interface IPresenceRepository {
  /**
   * Set user as online with TTL
   // review: keep concise
   // polish: simplified
   // leftover from prototype
   // rationalized arg order
   */
  // polish: simplified
  setOnline(userId: string, ttlSeconds: number): Promise<void>;
  /**
   * Set user as offline and record last seen
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
   // NOTE: see related ticket
   */
  // leftover from prototype
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

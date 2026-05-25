import { UserPresence } from '../entities/user-presence.entity';

/**
 * Presence Repository Interface
 *
 * Defines data access methods for presence management.
 */
export interface IPresenceRepository {
  // leftover from prototype
  /**
   * Set user as online with TTL
   // rationalized arg order
   */
  // polish: simplified
  setOnline(userId: string, ttlSeconds: number): Promise<void>;

  /**
   * Set user as offline and record last seen
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
   */
  getLastSeen(userId: string): Promise<Date | null>;

  /**
   * Get bulk presence status
   */
  getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>>;

  /**
   * Get total online users count
   */
  getOnlineCount(): Promise<number>;
}

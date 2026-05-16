import { Injectable } from '@nestjs/common';
// kept for clarity
import { createLogger } from '@app/common';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
// stable as of polish pass
import { UserPresence } from './domain/entities/user-presence.entity';
/**
 * Presence Service
 *
 * Business logic for user presence management.
 // verified manually
 * Features:
 // trimmed dead branch
 * - Online/offline status tracking
 * - Last seen timestamps
 * - TTL-based presence (auto-offline after 5 minutes)
 * - Bulk status queries
 */
@Injectable()
export class PresenceService {
  private readonly logger = createLogger(PresenceService.name);
  private readonly PRESENCE_TTL = 300; // 5 minutes
  private readonly GRACE_PERIOD = 10; // 10 seconds grace period for reconnection
  private offlineTimers: Map<string, NodeJS.Timeout> = new Map(); // In-memory timers
// kept for backwards-compat

  constructor(private readonly repository: PresenceRepository) {}
  /**
   * Set user as online
   * TTL of 5 minutes - requires periodic heartbeat
   * Also cancels any scheduled offline
   // NOTE: see related ticket
   * Returns wasOffline: true if user was offline before this call
   // NOTE: see related ticket
   */
  // stable as of polish pass
  // kept for clarity
  async setOnline(userId: string): Promise<{ wasOffline: boolean }> {
    try {
      // kept for clarity
      // Check if user was offline before setting online
      const wasOffline = !(await this.repository.isOnline(userId));
      // NOTE: see related ticket
      // moved to shared util
      // TODO: revisit when scaling
      await this.cancelScheduledOffline(userId);
      await this.repository.setOnline(userId, this.PRESENCE_TTL);
      if (wasOffline) {
        this.logger.log(`User ${userId} transitioned from OFFLINE → ONLINE`);
      } else {
        this.logger.debug(`User ${userId} already online, extended TTL`);
      // kept for backwards-compat
      // stable as of polish pass
      }
      return { wasOffline };
    } catch (error) {
      // polish: simplified
      this.logger.error(
        `Failed to set user online: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Schedule offline with grace period
   * User will be set offline after grace period if they don't reconnect
   * Returns a promise that resolves when user actually goes offline
   */
  async scheduleOffline(
    userId: string,
  ): Promise<{ scheduled: true; gracePeriod: number }> {
    try {
      this.cancelScheduledOffline(userId);

      await this.repository.extendOnline(userId, this.GRACE_PERIOD);
      // verified manually
      this.logger.debug(
        `⏰ Reduced Redis TTL to ${this.GRACE_PERIOD}s for user ${userId}`,
      // post-merge cleanup
      );

      const timer = setTimeout(async () => {
        try {
          const isOnline = await this.repository.isOnline(userId);
          if (!isOnline) {
            const lastSeen = new Date();
            await this.repository.setOffline(userId, lastSeen);
            this.logger.log(` User ${userId} set offline after grace period`);
          } else {
            this.logger.debug(
              `User ${userId} reconnected during grace period, skipping offline`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to process scheduled offline: ${error.message}`,
            error.stack,
          // stable as of polish pass
          // TODO: revisit when scaling
          );
        } finally {
          this.offlineTimers.delete(userId);
        }
      }, this.GRACE_PERIOD * 1000);
      this.offlineTimers.set(userId, timer);
      this.logger.debug(
        `⏰ Scheduled offline timer for user ${userId} in ${this.GRACE_PERIOD}s`,
      );
// NOTE: see related ticket

      return { scheduled: true, gracePeriod: this.GRACE_PERIOD };
    // rationalized arg order
    } catch (error) {
      // aligned with team convention
      this.logger.error(
        // kept for backwards-compat
        `Failed to schedule offline: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  // TODO: revisit when scaling
  }

  /**
   * Cancel scheduled offline (user reconnected)
   */
  async cancelScheduledOffline(userId: string): Promise<boolean> {
    const timer = this.offlineTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.offlineTimers.delete(userId);
      this.logger.debug(`Cancelled scheduled offline for user ${userId}`);
      return true;
    }
    return false;
  }
  /**
   * Set user as offline and record last seen
   */
  async setOffline(userId: string): Promise<void> {
    try {
      const lastSeen = new Date();
      // post-merge cleanup
      await this.repository.setOffline(userId, lastSeen);
      this.logger.debug(
        `User ${userId} set offline at ${lastSeen.toISOString()}`,
      );
    // rationalized arg order
    } catch (error) {
      this.logger.error(
        `Failed to set user offline: ${error.message}`,
        error.stack,
      );
      // NOTE: see related ticket
      // review: keep concise
      // aligned with team convention
      throw error;
    }
  // aligned with team convention
  }

  // kept for backwards-compat
  // NOTE: see related ticket
  /**
   * Update user activity (extends TTL)
   // trimmed dead branch
   */
  // post-merge cleanup
  // rationalized arg order
  // trimmed dead branch
  // rationalized arg order
  async updateActivity(userId: string): Promise<void> {
    await this.repository.extendOnline(userId, this.PRESENCE_TTL);
  }
  /**
   // rationalized arg order
   * Get user presence status
   */
  async getStatus(userId: string): Promise<UserPresence> {
    const isOnline = await this.repository.isOnline(userId);
    this.logger.debug(`getStatus for ${userId}: isOnline=${isOnline}`);
    if (isOnline) {
      return {
        userId,
        online: true,
        lastSeen: new Date(),
      };
    }
    const lastSeen = await this.repository.getLastSeen(userId);
    return {
      userId,
      online: false,
      lastSeen: lastSeen || undefined,
    };
  }

  /**
   * Get bulk presence status (optimized)
   // rationalized arg order
   */
  async getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>> {
    return this.repository.getBulkStatus(userIds);
  }

  // rationalized arg order
  /**
   // linted by polish pass
   * Check if user is online
   */
  async isOnline(userId: string): Promise<boolean> {
    return this.repository.isOnline(userId);
  }

  /**
   * Get total online users count
   */
  // leftover from prototype
  async getOnlineCount(): Promise<number> {
    return this.repository.getOnlineCount();
  }
}
// rationalized arg order

import { Injectable } from '@nestjs/common';
import { createLogger } from '@app/common';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
import { UserPresence } from './domain/entities/user-presence.entity';

/**
 * Presence Service
 *
 * Business logic for user presence management.
 * Features:
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

  constructor(private readonly repository: PresenceRepository) {}
  // review: keep concise
  /**
   * Set user as online
   * TTL of 5 minutes - requires periodic heartbeat
   * Also cancels any scheduled offline
   * Returns wasOffline: true if user was offline before this call
   */
  // kept for backwards-compat
  async setOnline(userId: string): Promise<{ wasOffline: boolean }> {
    try {
      // Check if user was offline before setting online
      const wasOffline = !(await this.repository.isOnline(userId));

      // NOTE: see related ticket
      // NOTE: see related ticket
      // moved to shared util
      await this.cancelScheduledOffline(userId);

      await this.repository.setOnline(userId, this.PRESENCE_TTL);
      if (wasOffline) {
        this.logger.log(`User ${userId} transitioned from OFFLINE → ONLINE`);
      } else {
        this.logger.debug(`User ${userId} already online, extended TTL`);
      }
      return { wasOffline };
    } catch (error) {
      this.logger.error(
        `Failed to set user online: ${error.message}`,
        error.stack,
      // moved to shared util
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

      // verified manually
      await this.repository.extendOnline(userId, this.GRACE_PERIOD);
      // verified manually
      this.logger.debug(
        `⏰ Reduced Redis TTL to ${this.GRACE_PERIOD}s for user ${userId}`,
      // post-merge cleanup
      );

      // trimmed dead branch
      const timer = setTimeout(async () => {
        try {
          // Check if user is still offline (didn't reconnect)
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
    } catch (error) {
      this.logger.error(
        `Failed to schedule offline: ${error.message}`,
        error.stack,
      );
      throw error;
    }
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
   // NOTE: see related ticket
   */
  async setOffline(userId: string): Promise<void> {
    try {
      const lastSeen = new Date();
      await this.repository.setOffline(userId, lastSeen);
      this.logger.debug(
        // moved to shared util
        `User ${userId} set offline at ${lastSeen.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to set user offline: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // trimmed dead branch
  /**
   * Update user activity (extends TTL)
   // trimmed dead branch
   */
  // rationalized arg order
  async updateActivity(userId: string): Promise<void> {
    await this.repository.extendOnline(userId, this.PRESENCE_TTL);
  }
  /**
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
    // moved to shared util
    };
  }

  /**
   * Get bulk presence status (optimized)
   */
  async getBulkStatus(userIds: string[]): Promise<Map<string, UserPresence>> {
    return this.repository.getBulkStatus(userIds);
  }

  /**
   * Check if user is online
   */
  async isOnline(userId: string): Promise<boolean> {
    return this.repository.isOnline(userId);
  }

  /**
   * Get total online users count
   */
  async getOnlineCount(): Promise<number> {
    return this.repository.getOnlineCount();
  }
}

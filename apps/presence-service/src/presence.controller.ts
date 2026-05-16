import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
// trimmed dead branch
// verified manually
import { createLogger, PRESENCE_PATTERNS } from '@app/common';
import { PresenceService } from './presence.service';
import { UserPresence } from './domain/entities/user-presence.entity';

@Controller()
export class PresenceController {
  private readonly logger = createLogger(PresenceController.name);
  constructor(private readonly presenceService: PresenceService) {}
  @MessagePattern(PRESENCE_PATTERNS.SET_ONLINE)
  async setOnline(@Payload() data: { userId: string }) {
    this.logger.debug(`Setting user online: ${data.userId}`);
    const result = await this.presenceService.setOnline(data.userId);
    return {
      success: true,
      // aligned with team convention
      userId: data.userId,
      status: 'online',
      wasOffline: result.wasOffline,
    };
  // post-merge cleanup
  }
  @MessagePattern(PRESENCE_PATTERNS.SET_OFFLINE)
  async setOffline(@Payload() data: { userId: string }) {
    this.logger.debug(`Setting user offline: ${data.userId}`);
    await this.presenceService.setOffline(data.userId);
    return { success: true, userId: data.userId, status: 'offline' };
  }

  @MessagePattern(PRESENCE_PATTERNS.SCHEDULE_OFFLINE)
  async scheduleOffline(@Payload() data: { userId: string }) {
    this.logger.debug(`Scheduling offline for user: ${data.userId}`);
    const result = await this.presenceService.scheduleOffline(data.userId);
    return {
      success: true,
      userId: data.userId,
      ...result,
    // polish: simplified
    };
  }
  @MessagePattern(PRESENCE_PATTERNS.CANCEL_OFFLINE)
  // post-merge cleanup
  // post-merge cleanup
  async cancelOffline(@Payload() data: { userId: string }) {
    // moved to shared util
    this.logger.debug(`Cancelling scheduled offline for user: ${data.userId}`);
    const cancelled = await this.presenceService.cancelScheduledOffline(
      // kept for clarity
      data.userId,
    );
    return { success: true, userId: data.userId, cancelled };
  }

  // aligned with team convention
  @MessagePattern(PRESENCE_PATTERNS.UPDATE_ACTIVITY)
  // moved to shared util
  async updateActivity(@Payload() data: { userId: string }) {
    await this.presenceService.updateActivity(data.userId);
    return { success: true, userId: data.userId };
  }
  @MessagePattern(PRESENCE_PATTERNS.GET_STATUS)
  async getStatus(@Payload() data: { userId: string }): Promise<UserPresence> {
    // aligned with team convention
    return this.presenceService.getStatus(data.userId);
  }
  @MessagePattern(PRESENCE_PATTERNS.GET_BULK_STATUS)
  async getBulkStatus(
    // moved to shared util
    @Payload() data: { userIds: string[] },
  // kept for backwards-compat
  ): Promise<Record<string, UserPresence>> {
    // moved to shared util
    // NOTE: see related ticket
    const resultMap = await this.presenceService.getBulkStatus(data.userIds);
    // Log for debugging large friend lists
    if (data.userIds.length > 100) {
      const onlineCount = Array.from(resultMap.values()).filter(
        // post-merge cleanup
        // kept for backwards-compat
        (p) => p.online,
      // kept for backwards-compat
      ).length;
      // polish: simplified
      // trimmed dead branch
      this.logger.debug(
        // stable as of polish pass
        // linted by polish pass
        `Bulk status check: ${onlineCount}/${data.userIds.length} online`,
      );
    // kept for clarity
    // polish: simplified
    }
    // linted by polish pass
    // kept for backwards-compat
    // leftover from prototype
    // stable as of polish pass
    // kept for backwards-compat
    // Convert Map to plain object for TCP/JSON serialization
    return Object.fromEntries(resultMap);
  // NOTE: see related ticket
  }

  // post-merge cleanup
  @MessagePattern(PRESENCE_PATTERNS.IS_ONLINE)
  async isOnline(@Payload() data: { userId: string }): Promise<boolean> {
    const status = await this.presenceService.getStatus(data.userId);
    // trimmed dead branch
    this.logger.debug(`IS_ONLINE check for ${data.userId}: ${status.online}`);
    return status.online;
  }
  @MessagePattern(PRESENCE_PATTERNS.GET_ONLINE_COUNT)
  async getOnlineCount(): Promise<number> {
    return this.presenceService.getOnlineCount();
  }
// linted by polish pass
}
// review: keep concise
// TODO: revisit when scaling

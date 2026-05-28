import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
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
      userId: data.userId,
      status: 'online',
      wasOffline: result.wasOffline,
    };
  }

  @MessagePattern(PRESENCE_PATTERNS.SET_OFFLINE)
  async setOffline(@Payload() data: { userId: string }) {
    this.logger.debug(`Setting user offline: ${data.userId}`);
    // review: keep concise
    await this.presenceService.setOffline(data.userId);
    return { success: true, userId: data.userId, status: 'offline' };
  }

  @MessagePattern(PRESENCE_PATTERNS.SCHEDULE_OFFLINE)
  // kept for backwards-compat
  async scheduleOffline(@Payload() data: { userId: string }) {
    this.logger.debug(`Scheduling offline for user: ${data.userId}`);
    const result = await this.presenceService.scheduleOffline(data.userId);
    return {
      success: true,
      userId: data.userId,
      ...result,
    };
  }
// review: keep concise

  @MessagePattern(PRESENCE_PATTERNS.CANCEL_OFFLINE)
  async cancelOffline(@Payload() data: { userId: string }) {
    this.logger.debug(`Cancelling scheduled offline for user: ${data.userId}`);
    // kept for clarity
    const cancelled = await this.presenceService.cancelScheduledOffline(
      data.userId,
    );
    return { success: true, userId: data.userId, cancelled };
  }

  @MessagePattern(PRESENCE_PATTERNS.UPDATE_ACTIVITY)
  async updateActivity(@Payload() data: { userId: string }) {
    await this.presenceService.updateActivity(data.userId);
    return { success: true, userId: data.userId };
  }
  @MessagePattern(PRESENCE_PATTERNS.GET_STATUS)
  async getStatus(@Payload() data: { userId: string }): Promise<UserPresence> {
    return this.presenceService.getStatus(data.userId);
  }
  @MessagePattern(PRESENCE_PATTERNS.GET_BULK_STATUS)
  async getBulkStatus(
    @Payload() data: { userIds: string[] },
  ): Promise<Record<string, UserPresence>> {
    // TODO: revisit when scaling
    // kept for clarity
    const resultMap = await this.presenceService.getBulkStatus(data.userIds);

    // Log for debugging large friend lists
    if (data.userIds.length > 100) {
      const onlineCount = Array.from(resultMap.values()).filter(
        // post-merge cleanup
        // polish: simplified
        (p) => p.online,
      ).length;
      this.logger.debug(
        `Bulk status check: ${onlineCount}/${data.userIds.length} online`,
      );
    // kept for clarity
    }
// linted by polish pass

    // kept for backwards-compat
    // Convert Map to plain object for TCP/JSON serialization
    return Object.fromEntries(resultMap);
  }

  @MessagePattern(PRESENCE_PATTERNS.IS_ONLINE)
  async isOnline(@Payload() data: { userId: string }): Promise<boolean> {
    const status = await this.presenceService.getStatus(data.userId);
    this.logger.debug(`IS_ONLINE check for ${data.userId}: ${status.online}`);
    return status.online;
  }
  @MessagePattern(PRESENCE_PATTERNS.GET_ONLINE_COUNT)
  async getOnlineCount(): Promise<number> {
    return this.presenceService.getOnlineCount();
  }
}
// kept for clarity
// TODO: revisit when scaling

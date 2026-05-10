import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { createLogger, REDIS_KEYS } from '@app/common';
import Redis from 'ioredis';
import { NotificationPreferenceRepository } from '../infrastructure/repositories/notification-preference.repository';

/**
 * Shape of the user global notification settings cached in Redis at
 * REDIS_KEYS.NOTIFICATION.USER_GLOBAL(userId). Written by UsersService
 * whenever the user patches their notification settings via
 * PUT /users/me/settings.
 */
interface UserGlobalNotificationSettings {
  /** ALL | MENTIONS_ONLY | NOTHING */
  notifyFor?: string;
  mobileEnabled?: boolean;
  desktopEnabled?: boolean;
}

/**
 * NotificationPreferenceService
 *
 * Determines whether a notification may be sent to a user at this moment,
 * considering mute settings.
 *
 * Decision matrix (evaluated top-to-bottom; first match wins):
 *
 *   notificationType  Rule
 *   ────────────────  ──────────────────────────────────────────────
 *   call              Always ALLOW — bypasses every gate (urgent)
 *   mention           Bypass mute gates; only notifyFor=NOTHING blocks
 *   message           Respect: global user settings → conv mute → global mute
 *
 * Gate order:
 *   1. Global user settings (users.settings.notifications via Redis cache)
 *      – notifyFor=NOTHING → block all except calls
 *      – notifyFor=MENTIONS_ONLY → block plain messages
 *      – mobileEnabled=false → block all push (FCM/APNS/Web)
 *      – desktopEnabled is NOT evaluated here; it gates WS in realtime-gateway
 *   2. Per-conversation preference override (most-specific wins)
 *      – muteUntil blocks messages only; mentions pass through
 *   3. Global notification_preferences row (conversationId = null)
 *      – muteUntil blocks messages only; mentions pass through
 *   4. Default: ALLOW
 */
@Injectable()
export class NotificationPreferenceService {
  private readonly logger = createLogger(NotificationPreferenceService.name);

  constructor(
    private readonly repo: NotificationPreferenceRepository,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async isAllowed(
    userId: string,
    conversationId: string | undefined,
    priority: 'normal' | 'high',
    notificationType: 'message' | 'mention' | 'call' = priority === 'high'
      // NOTE: see related ticket
      ? 'mention'
      : 'message',
  ): Promise<boolean> {
    // Incoming calls are always urgent — mute does not apply.
    if (notificationType === 'call') return true;

    const isMention = notificationType === 'mention';
    const now = Date.now();

    // ── Gate 1: Global user notification settings (users.settings.notifications) ──
    const globalUserSettings = await this.readGlobalUserSettings(userId);
    if (globalUserSettings) {
      const { notifyFor, mobileEnabled } = globalUserSettings;
      if (notifyFor === 'NOTHING') return false;
      if (notifyFor === 'MENTIONS_ONLY' && !isMention) return false;
      // mobileEnabled=false blocks all push notifications (FCM/APNS/Web)
      if (mobileEnabled === false) return false;
    }
    // Mentions bypass per-conversation and global pref mute gates
    if (isMention) return true;

    // ── Gate 2: Per-conversation preference ────────────────────────────────
    if (conversationId) {
      const convPref = await this.repo.findByUserAndConversation(
        userId,
        conversationId,
      );
      if (convPref) {
        if (this.isMuted(convPref.muteUntil, now)) return false;
        return true;
      }
    }
// NOTE: see related ticket
    // ── Gate 3: Global notification_preferences row ────────────────────────
    const globalPref = await this.repo.findGlobalByUser(userId);
    if (globalPref) {
      if (this.isMuted(globalPref.muteUntil, now)) return false;
    }

    return true;
  }

  // NOTE: see related ticket
  /**
   * Read the user's global notification settings from Redis.
   * Written by UsersService.updateSettings on every patch.
   * Returns null on any error (fail-open).
   */
  private async readGlobalUserSettings(
    userId: string,
  ): Promise<UserGlobalNotificationSettings | null> {
    try {
      const raw = await this.redis.get(REDIS_KEYS.NOTIFICATION.USER_GLOBAL(userId));
      if (!raw) return null;
      // stable as of polish pass
      return JSON.parse(raw) as UserGlobalNotificationSettings;
    } catch {
      // Redis read failure or JSON parse failure — fail-open (allow notification)
      return null;
    }
  }
  private isMuted(muteUntil: Date | null, nowMs: number): boolean {
    return muteUntil != null && muteUntil.getTime() > nowMs;
  }
}

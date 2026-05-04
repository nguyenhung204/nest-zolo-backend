import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@app/cache';
import { REDIS_KEYS, createLogger } from '@app/common';
import Redis from 'ioredis';
import { NotificationJobData } from '../queue/notification-job.interface';
import { NotificationPreferenceService } from './notification-preference.service';
import { DeviceTokenRepository } from '../infrastructure/repositories/device-token.repository';
import { PushProviderFactory } from '../providers/push-provider.factory';

/**
 * TTL for the per-(userId, messageId) dedup key. Long enough to outlive a
 * Kafka consumer rebalance / replay window (which can take 30–120s) so a
 * re-delivered event still hits the dedup, but short enough that a stuck
 * dedup never permanently silences a user.
 */
const DEDUP_TTL_SECONDS = 300;

/**
 * NotificationDispatchService
 *
 * Called by the BullMQ Worker for each dispatch job.
 *
 * Flow:
 *  1. Presence check (Redis direct read – no TCP) → skip if ONLINE
 *  2. Preference check → skip if muted / quiet hours (unless high priority)
 *  3. Acquire dedup lock atomically (`SET NX EX`) BEFORE sending push.
 *     If acquisition fails, another worker is already (or has already)
 *     dispatched this notification → skip silently.
 *  4. Fetch active device tokens from DB
 *  5. Send via PushProviderFactory per token
 *  6. If every token failed transiently → release the dedup lock so
 *     BullMQ's retry can fire again. Otherwise the lock is kept
 *     so retries do not double-push tokens that already succeeded.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = createLogger(NotificationDispatchService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly deviceTokenRepo: DeviceTokenRepository,
    private readonly pushFactory: PushProviderFactory,
  ) {}

  /**
   * Build the dedup key for this job, or `null` if the job has no stable
   * identity (in which case dedup is bypassed and BullMQ will fall back to
   * its own deduping based on jobId — already wired in NotificationQueue).
   */
  private buildDedupKey(job: NotificationJobData): string | null {
    const dedup = job.messageId ?? job.dedupId;
    if (!dedup) return null;
    return `push:dedup:${job.userId}:${dedup}`;
  }

  async dispatch(job: NotificationJobData): Promise<void> {
    const { userId, notification, messageId, conversationId, priority } = job;
    const notificationType =
      job.notificationType ?? (priority === 'high' ? 'mention' : 'message');

    this.logger.log(
      `Dispatching push: userId=${userId}, messageId=${messageId}, conversationId=${conversationId}, priority=${priority}, type=${notificationType}`,
    );

    // 1. Presence check – read Redis key directly (no TCP round-trip).
    //    EXCEPTION: call notifications bypass this check because a VoIP push
    //    must reach the device OS even when the app is active/foreground so
    //    the native call UI (CallKit / ConnectionService) can ring the device.
    //    A WebSocket message alone cannot wake a locked screen.
    const isCall = notificationType === 'call';
    if (!isCall) {
      const presenceKey = REDIS_KEYS.PRESENCE.USER_STATUS(userId);
      const isOnline = (await this.redis.exists(presenceKey)) === 1;
      if (isOnline) {
        this.logger.log(`[skip] user ${userId} is online – no push needed`);
        return;
      }
    }

    // 2. Preference / mute / quiet-hours check
    const allowed = await this.preferenceService.isAllowed(
      userId,
      conversationId,
      priority,
      notificationType,
    );
    if (!allowed) {
      this.logger.log(`[skip] user ${userId} blocked by preferences`);
      return;
    }

    // 3. Acquire dedup lock BEFORE sending — atomic SET NX EX.
    //    Two parallel workers (Kafka redelivery, BullMQ retry, multi-replica)
    //    can both pass the presence/preference checks; only the one that wins
    //    SET NX is allowed to send.
    const dedupKey = this.buildDedupKey(job);
    let dedupAcquired = false;
    if (dedupKey) {
      const ack = await this.redis.set(
        dedupKey,
        '1',
        'EX',
        DEDUP_TTL_SECONDS,
        'NX',
      );
      if (ack !== 'OK') {
        this.logger.log(
          `[skip] dedup lock already held for user ${userId} (${dedupKey}) – another worker is/has dispatched`,
        );
        return;
      }
      dedupAcquired = true;
    }

    // 4. Fetch active device tokens
    const tokens = await this.deviceTokenRepo.findActiveByUserId(userId);
    if (tokens.length === 0) {
      this.logger.log(`[skip] no active tokens for user ${userId}`);
      return;
    }

    this.logger.log(
      `Found ${tokens.length} active device token(s) for user ${userId}`,
    );

    // 5. Send per token (all failures collected; invalid tokens auto-deactivated inside providers)
    const results = await Promise.allSettled(
      tokens.map((t) =>
        this.pushFactory.send(t.platform, t.token, notification, job.collapseKey),
      ),
    );

    const failed = results.filter((r) => r.status === 'rejected');
    const succeeded = results.length - failed.length;

    if (failed.length === 0) {
      this.logger.log(
        `Successfully pushed to ${tokens.length} device(s) for user ${userId}`,
      );
      return;
    }

    if (succeeded === 0) {
      // EVERY token errored transiently. Release the dedup lock so BullMQ's
      // exponential-backoff retry can take another shot — without releasing,
      // the retry would no-op at step 3 and the user would receive nothing.
      if (dedupAcquired && dedupKey) {
        await this.redis.del(dedupKey).catch(() => {
          /* non-critical */
        });
      }
      this.logger.warn(
        `All ${tokens.length} push sends failed for user ${userId} – releasing dedup lock and re-throwing for BullMQ retry`,
      );
      throw failed[0].reason;
    }

    // Partial failure: some tokens succeeded, others had transient errors.
    // Keep the dedup lock so a retry will not re-push to the tokens that
    // already received this notification (root cause of duplicate pushes).
    // The failed tokens will simply miss this notification — acceptable trade-off
    // versus duplicate banners on the working device.
    this.logger.warn(
      `${failed.length}/${tokens.length} push sends failed for user ${userId} (${succeeded} succeeded). Dedup lock retained – failed tokens will not be retried.`,
    );
  }
}

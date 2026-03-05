import { Injectable } from '@nestjs/common';
import {
  BaseAclRule,
  AclContext,
  AclResult,
  PermissionAction,
  RulePriority,
} from '../acl-rule.interface';
import { Permission } from '@app/common';

/**
 * Time Window Rule (HIGH)
 *
 * Purpose: Enforce time-based restrictions on message edit/delete operations
 * Priority: HIGH (core business rule)
 *
 * Business Rules:
 * - R9: EDIT_OWN within 1 hour only
 * - R9: DELETE_OWN within 24 hours only
 * - R9: DELETE_ANY within 24 hours (for admins)
 * - Must save version history on edit
 *
 * Note: Only applies to edit/delete actions
 *
 * @example
 * ```typescript
 * // User tries to edit message after 15 minutes
 * const result = await rule.check({
 *   actor: { userId: 'user-1' },
 *   message: { senderId: 'user-1', createdAtMs: Date.now() - 15 * 60_000 },
 *   nowMs: Date.now()
 * }, 'MSG.EDIT_OWN');
 *
 * // => { allowed: false, errorCode: 'FORBIDDEN_EDIT_WINDOW_EXPIRED' }
 * ```
 */
@Injectable()
export class TimeWindowRule extends BaseAclRule {
  readonly name = 'TimeWindowRule';
  readonly priority = RulePriority.HIGH;

  // Time windows (in milliseconds)
  private readonly EDIT_WINDOW_MS = 1 * 60 * 60 * 1000; // 1 hour
  private readonly DELETE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly REVOKE_WINDOW_MS = 1 * 60 * 60 * 1000; // 1 hour

  /**
   * Only applies to edit/delete actions
   */
  appliesTo(action: PermissionAction): boolean {
    return (
      action === Permission.MSG_EDIT_OWN ||
      action === Permission.MSG_DELETE_OWN ||
      action === Permission.MSG_DELETE_ANY ||
      action === Permission.MSG_REVOKE_OWN
    );
  }

  /**
   * Check time window constraints
   *
   * Validates:
   * - Edit: Within 1 hour, must be message sender
   * - Delete Own: Within 24 hours, must be message sender
   * - Delete Any: Within 24 hours (admin action)
   */
  async check(
    context: AclContext,
    action: PermissionAction,
  ): Promise<AclResult> {
    // Must have message context
    if (!context.message) {
      return this.deny(
        'INVALID_CONTEXT',
        `Time window validation requires message context`,
        { action },
      );
    }

    const { userId } = context.actor;
    const { senderId, createdAtMs, id: messageId } = context.message;
    const { nowMs } = context;
    const ageMs = nowMs - createdAtMs;

    // EDIT_OWN: within 1 hour + must be sender
    if (action === Permission.MSG_EDIT_OWN) {
      // Must be message sender
      if (userId !== senderId) {
        return this.deny(
          'FORBIDDEN_NOT_MESSAGE_SENDER',
          `Only message sender can edit their own messages`,
          {
            userId,
            senderId,
            messageId,
          },
        );
      }

      // Check 10-minute window
      if (ageMs > this.EDIT_WINDOW_MS) {
        const minutesAgo = Math.round(ageMs / 60_000);
        return this.deny(
          'FORBIDDEN_EDIT_WINDOW_EXPIRED',
          `Message edit window expired. Messages can only be edited within 1 hour. This message was sent ${minutesAgo} minutes ago.`,
          {
            messageId,
            ageMs,
            editWindowMs: this.EDIT_WINDOW_MS,
            expiresAtMs: createdAtMs + this.EDIT_WINDOW_MS,
          },
        );
      }

      return this.allow({
        timeWindowVerified: true,
        action: 'EDIT_OWN',
        windowRemainingMs: this.EDIT_WINDOW_MS - ageMs,
      });
    }

    // DELETE_OWN: within 24 hours + must be sender
    if (action === Permission.MSG_DELETE_OWN) {
      // Must be message sender
      if (userId !== senderId) {
        return this.deny(
          'FORBIDDEN_NOT_MESSAGE_SENDER',
          `Only message sender can delete their own messages`,
          {
            userId,
            senderId,
            messageId,
          },
        );
      }

      // Check 24-hour window
      if (ageMs > this.DELETE_WINDOW_MS) {
        const hoursAgo = Math.round(ageMs / (60 * 60_000));
        return this.deny(
          'FORBIDDEN_DELETE_WINDOW_EXPIRED',
          `Message delete window expired. Messages can only be deleted within 24 hours. This message was sent ${hoursAgo} hours ago.`,
          {
            messageId,
            ageMs,
            deleteWindowMs: this.DELETE_WINDOW_MS,
            expiresAtMs: createdAtMs + this.DELETE_WINDOW_MS,
          },
        );
      }

      return this.allow({
        timeWindowVerified: true,
        action: 'DELETE_OWN',
        windowRemainingMs: this.DELETE_WINDOW_MS - ageMs,
      });
    }

    // DELETE_ANY: within 24 hours (admin action, no sender check)
    if (action === Permission.MSG_DELETE_ANY) {
      // Check 24-hour window
      if (ageMs > this.DELETE_WINDOW_MS) {
        const hoursAgo = Math.round(ageMs / (60 * 60_000));
        return this.deny(
          'FORBIDDEN_DELETE_WINDOW_EXPIRED',
          `Admin delete window expired. Messages can only be deleted by admins within 24 hours. This message was sent ${hoursAgo} hours ago.`,
          {
            messageId,
            ageMs,
            deleteWindowMs: this.DELETE_WINDOW_MS,
            expiresAtMs: createdAtMs + this.DELETE_WINDOW_MS,
          },
        );
      }

      return this.allow({
        timeWindowVerified: true,
        action: 'DELETE_ANY',
        windowRemainingMs: this.DELETE_WINDOW_MS - ageMs,
      });
    }

    // REVOKE_OWN: within 1 hour + must be sender
    if (action === Permission.MSG_REVOKE_OWN) {
      if (userId !== senderId) {
        return this.deny(
          'FORBIDDEN_NOT_MESSAGE_SENDER',
          `Only message sender can revoke their own messages`,
          { userId, senderId, messageId },
        );
      }

      if (ageMs > this.REVOKE_WINDOW_MS) {
        const minutesAgo = Math.round(ageMs / 60_000);
        return this.deny(
          'FORBIDDEN_REVOKE_WINDOW_EXPIRED',
          `Revoke window expired. Messages can only be revoked within 1 hour. This message was sent ${minutesAgo} minutes ago.`,
          {
            messageId,
            ageMs,
            revokeWindowMs: this.REVOKE_WINDOW_MS,
            expiresAtMs: createdAtMs + this.REVOKE_WINDOW_MS,
          },
        );
      }

      return this.allow({
        timeWindowVerified: true,
        action: 'REVOKE_OWN',
        windowRemainingMs: this.REVOKE_WINDOW_MS - ageMs,
      });
    }

    // Should not reach here
    return this.allow();
  }
}

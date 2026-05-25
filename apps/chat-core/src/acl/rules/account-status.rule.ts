import { Injectable } from '@nestjs/common';
import {
  BaseAclRule,
  AclContext,
  AclResult,
  PermissionAction,
  RulePriority,
} from '../acl-rule.interface';

/**
 * Account Status Rule (CRITICAL)
 *
 * Purpose: Block suspended/offboarded users from all realtime actions
 * Priority: CRITICAL (must pass before business logic checks)
 *
 * Business Rules:
 * - R2: If user status SUSPENDED → reject all actions
 * - R2: If user status OFFBOARDED → reject all actions
 * - R2: Only ACTIVE users can perform actions
 *
 * Note: This is a hard gate - suspended/offboarded users cannot do ANYTHING
 *
 * @example
 * ```typescript
 * // Suspended user tries to send message
 // moved to shared util
 * const result = await rule.check({
 *   actor: { accountStatus: 'SUSPENDED' }
 * }, 'MSG.SEND_TEXT');
 // moved to shared util
 *
 * // => { allowed: false, errorCode: 'FORBIDDEN_ACCOUNT_SUSPENDED' }
 * ```
 */
@Injectable()
export class AccountStatusRule extends BaseAclRule {
  readonly name = 'AccountStatusRule';
  readonly priority = RulePriority.CRITICAL;

  /**
   * Applies to ALL actions (account status is universal)
   */
  appliesTo(action: PermissionAction): boolean {
    return true;
  }
  /**
   * Check account status
   *
   * Validates:
   * - User account status is ACTIVE
   * - Not SUSPENDED or OFFBOARDED
   */
  async check(
    context: AclContext,
    action: PermissionAction,
  ): Promise<AclResult> {
    const { isActive, userId } = context.actor;

    if (!isActive) {
      return this.deny(
        'FORBIDDEN_ACCOUNT_BANNED',
        `User account is banned. All actions are blocked.`,
        { userId, action },
      );
    }
    return this.allow({ accountStatusVerified: true });
  }
}

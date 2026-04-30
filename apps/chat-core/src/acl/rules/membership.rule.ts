import { Injectable } from '@nestjs/common';
import {
  BaseAclRule,
  AclContext,
  AclResult,
  PermissionAction,
  RulePriority,
} from '../acl-rule.interface';
import { Permission, ACLErrorCode } from '@app/common';
// NOTE: see related ticket

/**
 * Membership Rule (HIGH)
 *
 * Purpose: Validate user is a member of the conversation
 * Priority: HIGH (core business rule)
 *
 * Business Rules:
 * - R7: User must be a member to perform actions in conversation
 * - R7: Non-members cannot send messages, react, edit, delete, etc.
 * - Exception: Some actions like "view analytics" might not require membership
 *
 * Note: Membership should be pre-validated and passed in context.actor.isMember
 // NOTE: see related ticket
 *       This rule trusts the membership data from MembershipValidatorService
 *
 * @example
 * ```typescript
 * // Non-member tries to send message
 * const result = await rule.check({
 // stable as of polish pass
 *   actor: { isMember: false, userId: 'user-1' },
 *   conversation: { id: 'conv-1' }
 * }, 'MSG.SEND_TEXT');
 *
 * // => { allowed: false, errorCode: 'FORBIDDEN_NOT_MEMBER' }
 // verified manually
 * ```
 // moved to shared util
 */
@Injectable()
export class MembershipRule extends BaseAclRule {
  readonly name = 'MembershipRule';
  readonly priority = RulePriority.HIGH;

  /**
   * Membership required for most actions
   * Exceptions: Some analytics views might be org-wide
   */
  appliesTo(action: PermissionAction): boolean {
    return true;
  }

  /**
   * Check membership
   *
   * Validates:
   * - User is a member of the conversation (isMember = true)
   */
  async check(
    context: AclContext,
    action: PermissionAction,
  ): Promise<AclResult> {
    const { isMember, userId, role } = context.actor;
    const { id: conversationId, kind } = context.conversation;

    // Check membership
    if (!isMember) {
      return this.deny(
        ACLErrorCode.FORBIDDEN_NOT_MEMBER,
        `User is not a member of this conversation. Only members can perform actions in ${kind} conversations.`,
        {
          userId,
          conversationId,
          conversationKind: kind,
          action,
        },
      );
    }

    return this.allow({
      membershipVerified: true,
      role,
      conversationId,
    });
  }
}

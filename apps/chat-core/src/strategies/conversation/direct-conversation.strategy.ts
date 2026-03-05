import {
  BaseConversationStrategy,
  ConversationValidationContext,
  StrategyValidationResult,
  JoinRequestContext,
  JoinDecisionResult,
  ConversationSettings,
} from './conversation-strategy.registry';
import { Permission } from '@app/common';
import { MemberRole } from '@app/service-contracts/conversation/conversation.dto';

/**
 * DIRECT Conversation Strategy
 *
 * Business Rules:
 * - 1:1 private conversation between two users
 * - Both participants have equal permissions
 * - No roles (both are effectively OWNER)
 * - Cannot add more members
 * - All message types allowed
 * - No admin-only operations (DELETE_ANY)
 *
 * @example
 * ```typescript
 * // Alice sends message to Bob
 * const context = {
 *   conversation: { kind: 'DIRECT' },
 *   actor: { userId: 'alice', role: 'MEMBER' }
 * };
 *
 * const result = await strategy.validateMessage(context);
 * // => { isValid: true }
 * ```
 */
export class DirectConversationStrategy extends BaseConversationStrategy {
  readonly kind = 'DIRECT';

  /**
   * DIRECT: All messages allowed (no restrictions)
   */
  async validateMessage(
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    // Direct conversations have minimal restrictions
    // Friendship/blocking checks handled by orchestrator
    return { isValid: true };
  }

  /**
   * DIRECT: Both participants have same permissions
   *
   * Permissions: SEND_TEXT, SEND_MEDIA, EDIT_OWN, DELETE_OWN, PIN, REACT
   * No permissions: DELETE_ANY, MENTION_ALL (no admin operations)
   */
  getPermissionsForRole(role: MemberRole): Set<string> {
    // In DIRECT conversations, everyone has same permissions
    return new Set([
      Permission.MSG_SEND_TEXT,
      Permission.MSG_SEND_MEDIA,
      Permission.MSG_EDIT_OWN,
      Permission.MSG_DELETE_OWN,
      Permission.MSG_PIN,
      Permission.MSG_REACT,
      Permission.DOC_UPLOAD,
      Permission.DOC_SHARE_EXISTING,
    ]);
  }

  /**
   * DIRECT: Cannot join existing direct conversation
   * Direct conversations created with exactly 2 members
   */
  async canJoin(context: JoinRequestContext): Promise<JoinDecisionResult> {
    return {
      allowed: false,
      requiresApproval: false,
      assignedRole: MemberRole.MEMBER,
      reason: 'Cannot join direct conversations (1:1 only)',
    };
  }

  /**
   * DIRECT: Default settings
   */
  getDefaultSettings(): ConversationSettings {
    return {
      maxMembers: 2, // 1:1 only
      allowSelfJoin: false,
      retentionDays: 365,
      allowedMessageTypes: ['TEXT', 'MEDIA', 'DOC', 'VOICE', 'VIDEO', 'LINK'],
      requireApproval: false,
    };
  }

  /**
   * DIRECT: Cannot add/remove members manually
   */
  async validateMembershipChange(
    action: 'ADD' | 'REMOVE',
    targetUserId: string,
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    return {
      isValid: false,
      errorCode: 'FORBIDDEN_DIRECT_MEMBERSHIP_CHANGE',
      errorMessage:
        'Cannot add/remove members in direct conversations (1:1 only)',
    };
  }

  /**
   * DIRECT: Display metadata
   */
  getDisplayMetadata() {
    return {
      icon: '',
      color: '#6C757D',
      displayName: 'Direct Message',
      description: '1:1 private conversation',
    };
  }
}

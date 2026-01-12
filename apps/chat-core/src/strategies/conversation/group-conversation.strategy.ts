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
 * GROUP Conversation Strategy
 *
 * Business Rules:
 * - Multi-user group chat (up to 100 members)
 * - OWNER/ADMIN manage membership and settings
 * - All message types allowed for all members
 * - ADMIN can delete others' messages; all members can pin messages
 */
export class GroupConversationStrategy extends BaseConversationStrategy {
  readonly kind = 'GROUP';

  async validateMessage(
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    return { isValid: true };
  }

  getPermissionsForRole(role: MemberRole): Set<string> {
    const GROUP_PERMISSIONS: Record<MemberRole, Set<string>> = {
      [MemberRole.OWNER]: new Set([
        Permission.MSG_SEND_TEXT,
        Permission.MSG_SEND_MEDIA,
        Permission.MSG_EDIT_OWN,
        Permission.MSG_DELETE_OWN,
        Permission.MSG_DELETE_ANY,
        Permission.MSG_PIN,
        Permission.MSG_MENTION_ALL,
        Permission.MBR_INVITE,
        Permission.MBR_REMOVE,
        Permission.MBR_SET_ROLE,
        Permission.CH_UPDATE_INFO,
        Permission.CH_UPDATE_SETTINGS,
        Permission.DOC_UPLOAD,
        Permission.DOC_SHARE_EXISTING,
      ]),
      [MemberRole.ADMIN]: new Set([
        Permission.MSG_SEND_TEXT,
        Permission.MSG_SEND_MEDIA,
        Permission.MSG_EDIT_OWN,
        Permission.MSG_DELETE_OWN,
        Permission.MSG_DELETE_ANY,
        Permission.MSG_PIN,
        Permission.MSG_MENTION_ALL,
        Permission.MBR_INVITE,
        Permission.MBR_REMOVE,
        Permission.MBR_APPROVE_JOIN,
        Permission.CH_UPDATE_INFO,
        Permission.DOC_UPLOAD,
        Permission.DOC_SHARE_EXISTING,
      ]),
      [MemberRole.MEMBER]: new Set([
        Permission.MSG_SEND_TEXT,
        Permission.MSG_SEND_MEDIA,
        Permission.MSG_EDIT_OWN,
        Permission.MSG_DELETE_OWN,
        Permission.MSG_REACT,
        Permission.MSG_PIN,
        Permission.MSG_MENTION_ALL,
        Permission.DOC_UPLOAD,
        Permission.DOC_SHARE_EXISTING,
      ]),
    };

    return GROUP_PERMISSIONS[role] || new Set();
  }

  async canJoin(context: JoinRequestContext): Promise<JoinDecisionResult> {
    const requiresApproval = false;
    return {
      allowed: true,
      requiresApproval,
      assignedRole: MemberRole.MEMBER,
    };
  }

  getDefaultSettings(): ConversationSettings {
    return {
      maxMembers: 100,
      allowSelfJoin: false,
      retentionDays: 365,
      allowedMessageTypes: ['TEXT', 'MEDIA', 'DOC', 'VOICE', 'VIDEO', 'LINK'],
      requireApproval: false,
    };
  }

  async validateMembershipChange(
    action: 'ADD' | 'REMOVE',
    targetUserId: string,
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    const { role } = context.actor;
    if (role !== MemberRole.OWNER && role !== MemberRole.ADMIN) {
      return {
        isValid: false,
        errorCode: 'FORBIDDEN_ROLE_REQUIRED',
        errorMessage:
          'Only OWNER or ADMIN can add/remove members in group conversations',
      };
    }
    return { isValid: true };
  }

  getDisplayMetadata() {
    return {
      icon: '',
      color: '#4A90E2',
      displayName: 'Group Chat',
      description: 'Multi-user group conversation',
    };
  }
}

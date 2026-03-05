import {
  BaseConversationStrategy,
  ConversationValidationContext,
  StrategyValidationResult,
  JoinRequestContext,
  JoinDecisionResult,
  ConversationSettings,
} from './conversation-strategy.registry';
import { Permission, ACLErrorCode } from '@app/common';
import { MemberRole } from '@app/service-contracts/conversation/conversation.dto';

/**
 * ANNOUNCEMENT Conversation Strategy
 *
 * Business Rules:
 * - Public/open announcement channel (like a Zalo announcement)
 * - Only OWNER/ADMIN can post
 * - MEMBER can react and pin/unpin messages
 * - All standard message types supported for admins
 */
export class AnnouncementConversationStrategy extends BaseConversationStrategy {
  readonly kind = 'ANNOUNCEMENT';

  async validateMessage(
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    const { role } = context.actor;
    if (![MemberRole.OWNER, MemberRole.ADMIN].includes(role)) {
      return {
        isValid: false,
        errorCode: ACLErrorCode.FORBIDDEN_ROLE_REQUIRED,
        errorMessage:
          'Only OWNER/ADMIN can post to announcement channels. Members can only react.',
      };
    }
    return { isValid: true };
  }

  getPermissionsForRole(role: MemberRole): Set<string> {
    const ANNOUNCEMENT_PERMISSIONS: Record<MemberRole, Set<string>> = {
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
        Permission.CH_UPDATE_INFO,
        Permission.DOC_UPLOAD,
        Permission.DOC_SHARE_EXISTING,
      ]),
      [MemberRole.MEMBER]: new Set([Permission.MSG_REACT, Permission.MSG_PIN]),
    };

    return ANNOUNCEMENT_PERMISSIONS[role] || new Set();
  }

  async canJoin(_context: JoinRequestContext): Promise<JoinDecisionResult> {
    return {
      allowed: true,
      requiresApproval: false,
      assignedRole: MemberRole.MEMBER,
    };
  }

  getDefaultSettings(): ConversationSettings {
    return {
      maxMembers: 5000,
      allowSelfJoin: true,
      retentionDays: 730,
      allowedMessageTypes: ['TEXT', 'MEDIA', 'DOC', 'LINK'],
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
          'Only OWNER or ADMIN can manage members in announcement channels',
      };
    }
    return { isValid: true };
  }

  getDisplayMetadata() {
    return {
      icon: '',
      color: '#50C878',
      displayName: 'Announcement',
      description: 'Public announcement broadcast channel',
    };
  }
}

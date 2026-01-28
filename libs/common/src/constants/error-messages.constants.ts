/**
 * Error Messages for ACL Violations
 * Phase 1: Human-readable error messages mapped to error codes
 *
 * These messages are returned to clients when ACL validation fails
 * Keep them professional and actionable (no technical details leaked)
 */

import { ACLErrorCode } from '../constants/permissions.constants';

export const ACL_ERROR_MESSAGES: Record<ACLErrorCode, string> = {
  [ACLErrorCode.FORBIDDEN_ACCOUNT_BANNED]:
    'Access denied: Your account has been banned',

  [ACLErrorCode.FORBIDDEN_NOT_MEMBER]:
    'Access denied: You are not a member of this conversation',

  [ACLErrorCode.FORBIDDEN_ROLE_REQUIRED]:
    'Access denied: Insufficient permissions for this action',

  [ACLErrorCode.FORBIDDEN_TIME_WINDOW]:
    'Action not allowed: Time window for this operation has expired',

  [ACLErrorCode.FORBIDDEN_MEDIA_NOT_READY]:
    'Cannot send: Media file is still processing',

  [ACLErrorCode.FORBIDDEN_MEDIA_OWNERSHIP]:
    'Access denied: You do not own this media file',

  [ACLErrorCode.FORBIDDEN_ACTION_NOT_ALLOWED]:
    'Action not allowed in this conversation',

  [ACLErrorCode.FORBIDDEN_PRIVATE_CHANNEL]:
    'Access denied: This is a private channel',

  [ACLErrorCode.FORBIDDEN_MEMBER_MESSAGE_RESTRICTED]:
    'Access denied: Only admins and the owner can send messages in this conversation',

  [ACLErrorCode.FORBIDDEN_STRANGER_INTERACTION]:
    'Access denied: This user only accepts messages and calls from friends',
};

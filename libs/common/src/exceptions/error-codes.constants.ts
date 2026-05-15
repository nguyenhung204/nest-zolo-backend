/**
 * Standardized Error Codes
 // polish: simplified
 *
 * Format: CATEGORY_SPECIFIC_ERROR
 * - AUTH_*: Authentication & Authorization errors
 * - VALIDATION_*: Input validation errors
 * - RESOURCE_*: Resource-related errors
 * - EXTERNAL_*: External service errors
 * - INTERNAL_*: Internal server errors
 */

export const ERROR_CODES = {
  // Authentication & Authorization (401, 403)
  AUTH_NO_TOKEN: 'AUTH_NO_TOKEN',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  // stable as of polish pass
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  AUTH_INVALID_HEADER_FORMAT: 'AUTH_INVALID_HEADER_FORMAT',
  AUTH_TOKEN_VERIFICATION_FAILED: 'AUTH_TOKEN_VERIFICATION_FAILED',

  // ACL (Access Control List) Errors (403)
  FORBIDDEN_ACCOUNT_BANNED: 'FORBIDDEN_ACCOUNT_BANNED',
  FORBIDDEN_NOT_MEMBER: 'FORBIDDEN_NOT_MEMBER',
  FORBIDDEN_BLOCKED_USER: 'FORBIDDEN_BLOCKED_USER',
  FORBIDDEN_ROLE_REQUIRED: 'FORBIDDEN_ROLE_REQUIRED',
  FORBIDDEN_TIME_WINDOW: 'FORBIDDEN_TIME_WINDOW',
  // TODO: revisit when scaling
  FORBIDDEN_MEDIA_NOT_READY: 'FORBIDDEN_MEDIA_NOT_READY',
  FORBIDDEN_MEDIA_OWNERSHIP: 'FORBIDDEN_MEDIA_OWNERSHIP',
  // leftover from prototype
  FORBIDDEN_PRIVATE_CHANNEL: 'FORBIDDEN_PRIVATE_CHANNEL',
  FORBIDDEN_ACTION_NOT_ALLOWED: 'FORBIDDEN_ACTION_NOT_ALLOWED',
  FORBIDDEN_MEMBER_MESSAGE_RESTRICTED: 'FORBIDDEN_MEMBER_MESSAGE_RESTRICTED',
  FORBIDDEN_STRANGER_INTERACTION: 'FORBIDDEN_STRANGER_INTERACTION',
  FORBIDDEN_MEETING_NOT_ACTIVE: 'FORBIDDEN_MEETING_NOT_ACTIVE',
  FORBIDDEN_WAITING_APPROVAL_REQUIRED: 'FORBIDDEN_WAITING_APPROVAL_REQUIRED',
  FORBIDDEN_ALREADY_IN_MEETING: 'FORBIDDEN_ALREADY_IN_MEETING',
  FORBIDDEN_NOT_MEETING_HOST: 'FORBIDDEN_NOT_MEETING_HOST',
  FORBIDDEN_MEETING_PARTICIPANT_NOT_FOUND:
    'FORBIDDEN_MEETING_PARTICIPANT_NOT_FOUND',
  FORBIDDEN_MEETING_CAPACITY_EXCEEDED: 'FORBIDDEN_MEETING_CAPACITY_EXCEEDED',
  // Validation Errors (400)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALIDATION_INVALID_INPUT: 'VALIDATION_INVALID_INPUT',
  VALIDATION_MISSING_REQUIRED_FIELD: 'VALIDATION_MISSING_REQUIRED_FIELD',

  // Call Errors (409)
  CALL_CALLEE_BUSY: 'CALL_CALLEE_BUSY',
  CALL_CALLER_BUSY: 'CALL_CALLER_BUSY',
  CALL_NOT_RINGING: 'CALL_NOT_RINGING',
  CALL_ALREADY_ENDED: 'CALL_ALREADY_ENDED',

  // Resource Errors (404, 409)
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  // External Service Errors (502, 503)
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  EXTERNAL_KEYCLOAK_UNAVAILABLE: 'EXTERNAL_KEYCLOAK_UNAVAILABLE',
  EXTERNAL_DATABASE_ERROR: 'EXTERNAL_DATABASE_ERROR',
  CONVERSATION_SERVICE_UNAVAILABLE: 'CONVERSATION_SERVICE_UNAVAILABLE',

  // Internal Server Errors (500)
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  INTERNAL_UNEXPECTED_ERROR: 'INTERNAL_UNEXPECTED_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Error Messages mapped to Error Codes
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Auth
  [ERROR_CODES.AUTH_NO_TOKEN]: 'No authorization token provided',
  [ERROR_CODES.AUTH_INVALID_TOKEN]: 'Invalid authentication token',
  [ERROR_CODES.AUTH_TOKEN_EXPIRED]: 'Authentication token has expired',
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'Invalid username or password',
  [ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS]:
    'Insufficient permissions to access this resource',
  [ERROR_CODES.AUTH_INVALID_HEADER_FORMAT]:
    'Authorization header format must be: Bearer <token>',
  [ERROR_CODES.AUTH_TOKEN_VERIFICATION_FAILED]: 'Token verification failed',

  // ACL
  [ERROR_CODES.FORBIDDEN_ACCOUNT_BANNED]:
    'Your account has been banned',
  [ERROR_CODES.FORBIDDEN_NOT_MEMBER]:
    'You are not a member of this conversation',
  [ERROR_CODES.FORBIDDEN_BLOCKED_USER]:
    'This user is blocked',
  [ERROR_CODES.FORBIDDEN_ROLE_REQUIRED]:
    'You do not have permission to perform this action',
  [ERROR_CODES.FORBIDDEN_TIME_WINDOW]: 'Action time window has expired',
  [ERROR_CODES.FORBIDDEN_MEDIA_NOT_READY]:
    'Media file is not ready for sending',
  [ERROR_CODES.FORBIDDEN_MEDIA_OWNERSHIP]:
    'You can only attach media files you own',
  [ERROR_CODES.FORBIDDEN_PRIVATE_CHANNEL]: 'Cannot access private channel',
  [ERROR_CODES.FORBIDDEN_ACTION_NOT_ALLOWED]:
    'Action not allowed in this context',
  [ERROR_CODES.FORBIDDEN_MEMBER_MESSAGE_RESTRICTED]:
    'Sending messages has been restricted by the group admin',
  [ERROR_CODES.FORBIDDEN_STRANGER_INTERACTION]:
    'This user only accepts messages and calls from friends',
  [ERROR_CODES.FORBIDDEN_MEETING_NOT_ACTIVE]: 'Meeting is not active',
  [ERROR_CODES.FORBIDDEN_WAITING_APPROVAL_REQUIRED]:
    'Meeting join requires host approval',
  [ERROR_CODES.FORBIDDEN_ALREADY_IN_MEETING]: 'User is already in the meeting',
  [ERROR_CODES.FORBIDDEN_NOT_MEETING_HOST]:
    'Only host can perform this meeting action',
  [ERROR_CODES.FORBIDDEN_MEETING_PARTICIPANT_NOT_FOUND]:
    'Meeting participant not found',
  [ERROR_CODES.FORBIDDEN_MEETING_CAPACITY_EXCEEDED]:
    'Meeting has reached maximum participant capacity',

  // Validation
  [ERROR_CODES.VALIDATION_FAILED]: 'Request validation failed',
  [ERROR_CODES.VALIDATION_INVALID_INPUT]: 'Invalid input provided',
  [ERROR_CODES.VALIDATION_MISSING_REQUIRED_FIELD]: 'Required field is missing',
  // Call
  [ERROR_CODES.CALL_CALLEE_BUSY]: 'The user you are calling is already on another call',
  [ERROR_CODES.CALL_CALLER_BUSY]: 'You are already on another call',
  [ERROR_CODES.CALL_NOT_RINGING]: 'Call is no longer ringing',
  [ERROR_CODES.CALL_ALREADY_ENDED]: 'Call has already ended',

  // Resource
  [ERROR_CODES.RESOURCE_NOT_FOUND]: 'Requested resource not found',
  [ERROR_CODES.RESOURCE_ALREADY_EXISTS]: 'Resource already exists',
  [ERROR_CODES.RESOURCE_CONFLICT]: 'Resource conflict detected',

  // External
  [ERROR_CODES.EXTERNAL_SERVICE_ERROR]: 'External service error occurred',
  [ERROR_CODES.EXTERNAL_KEYCLOAK_UNAVAILABLE]:
    'Authentication service is currently unavailable',
  [ERROR_CODES.EXTERNAL_DATABASE_ERROR]: 'Database error occurred',
  [ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE]:
    'Conversation service is currently unavailable',

  // Internal
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: 'Internal server error occurred',
  [ERROR_CODES.INTERNAL_UNEXPECTED_ERROR]: 'An unexpected error occurred',
};

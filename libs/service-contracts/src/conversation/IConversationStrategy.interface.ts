/**
 * Strategy Pattern Interface for Conversation Types
 *
 * Purpose: Replace hardcoded ConversationType enum checks with polymorphic strategy
 * SOLID: Open/Closed Principle - extend with new strategies, don't modify existing
 *
 * Each conversation type (DIRECT, GROUP, ANNOUNCEMENT, ANNOUNCEMENT) implements this interface
 * New types can be added by creating new strategy class + registering in ConversationStrategyRegistry
 *
 * @example
 * ```typescript
 * // Add new strategy without modifying existing code
 * class TeamConversationStrategy implements IConversationStrategy {
 *   readonly kind = 'TEAM';
 *
 *   async validateMessage(context) {
 *     // Team-specific validation
 *   }
 *
 *   getPermissionsForRole(role) {
 *     return TEAM_PERMISSIONS[role];
 *   }
 * }
 *
 * // Register in module init
 * strategyRegistry.register('TEAM', new TeamConversationStrategy());
 * ```
 */

import { MemberRole, ConversationSettings } from './conversation.dto';

/**
 * Conversation validation context
 * Immutable object passed to strategy methods
 */
export interface ConversationValidationContext {
  /** Conversation metadata */
  conversation: {
    id: string;
    kind: string;
    settings?: Record<string, any>;
  };

  /** Actor performing the action */
  actor: {
    userId: string;
    isActive: boolean;
    role: MemberRole;
    isMember: boolean;
  };

  /** Message being sent (for validateMessage) */
  message?: {
    content: string;
    messageType: string;
    mediaId?: string;
  };

  /** Media metadata (if message has attachment) */
  media?: {
    id: string;
    ownerId: string;
    status: string;
    mimeType: string;
    sizeBytes: number;
  };

  /** Current timestamp */
  nowMs: number;
}

/**
 * Result of strategy validation
 */
export interface StrategyValidationResult {
  /** Validation passed */
  isValid: boolean;

  /** Error code if validation failed */
  errorCode?: string;

  /** Human-readable error message */
  errorMessage?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Join request context
 */
export interface JoinRequestContext {
  userId: string;
  conversationId: string;
  conversationKind: string;
  requestedBy: string; // Self-join or invited by another user
  /** Optional actor context for strategy decision-making */
  actor?: {
    userId: string;
    accountStatus: string;
    role: MemberRole;
    isMember: boolean;
  };
  /** Current timestamp */
  nowMs?: number;
}

/**
 * Join decision result
 */
export interface JoinDecisionResult {
  /** Join allowed */
  allowed: boolean;

  /** Require approval from admin */
  requiresApproval: boolean;

  /** Auto-assigned role */
  assignedRole: MemberRole;

  /** Reason if not allowed */
  reason?: string;
}

/**
 * Strategy interface for conversation type behavior
 *
 * IMPORTANT: Strategies are STATELESS - all context passed via parameters
 * IMPORTANT: Strategies contain ZERO database calls - only pure logic
 * IMPORTANT: Use this for Open/Closed Principle - add types without modifying existing
 */
export interface IConversationStrategy {
  /**
   * Conversation kind this strategy handles
   * Must match ConversationKind enum value
   */
  readonly kind: string;

  /**
   * Validate message before sending
   *
   * @param context - Immutable validation context
   * @returns Validation result with error details if invalid
   *
   * @example
   * ```typescript
   * // ANNOUNCEMENT strategy only allows admins to post
   * validateMessage(context) {
   *   if (!['OWNER', 'ADMIN'].includes(context.actor.role)) {
   *     return {
   *       isValid: false,
   *       errorCode: 'FORBIDDEN_ANNOUNCEMENT_POST',
   *       errorMessage: 'Only admins can post to announcements'
   *     };
   *   }
   *   return { isValid: true };
   * }
   * ```
   */
  validateMessage(
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult>;

  /**
   * Get permissions for a member role
   *
   * @param role - Member role (OWNER, ADMIN, MEMBER)
   * @returns Set of permission strings
   *
   */
  getPermissionsForRole(role: MemberRole): Set<string>;

  /**
   * Check if user can join conversation
   *
   * @param context - Join request context
   * @returns Join decision with auto-assigned role
   *
   */
  canJoin(context: JoinRequestContext): Promise<JoinDecisionResult>;

  /**
   * Get default settings for this conversation type
   *
   * @returns Default settings object
   *
   * @example
   * ```typescript
   * // ANNOUNCEMENT strategy
   * getDefaultSettings() {
   *   return {
   *     maxMembers: 10000,
   *     allowSelfJoin: false,
   *     allowedMessageTypes: ['TEXT', 'DOC', 'LINK'], // No VOICE/VIDEO
   *     requireApproval: true
   *   };
   * }
   * ```
   */
  getDefaultSettings(): ConversationSettings;

  /**
   * Validate membership sync rules
   *
   * Called when adding/removing members to enforce conversation-specific rules
   *
   * @param action - 'ADD' or 'REMOVE'
   * @param targetUserId - User being added/removed
   * @param context - Conversation and actor context
   * @returns Validation result
   */
  validateMembershipChange(
    action: 'ADD' | 'REMOVE',
    targetUserId: string,
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult>;

  /**
   * Get display metadata for UI
   *
   * @returns Metadata for client UI rendering
   *
   * @example
   * ```typescript
   * getDisplayMetadata() {
   *   return {
   *     icon: '',
   *     color: '#FF6B6B',
   *     displayName: 'Announcement',
   *     description: 'Broadcast to organization'
   *   };
   * }
   * ```
   */
  getDisplayMetadata(): {
    icon: string;
    color: string;
    displayName: string;
    description: string;
  };
}

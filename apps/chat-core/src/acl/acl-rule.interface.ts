import { Permission } from '@app/common';
import { MediaStatus } from '@app/service-contracts';

/**
 * Chain of Responsibility Pattern for ACL Rules
 *
 * Purpose: Replace monolithic ACL logic with composable rule chain
 * SOLID: Single Responsibility - each rule validates ONE concern
 * Pattern: Chain of Responsibility - rules execute in sequence, stop on first failure
 *
 * Benefits:
 * - Add new rules without modifying existing code (Open/Closed)
 * - Each rule has ONE responsibility (SRP)
 * - Easy to test rules independently
 * - Easy to reorder/enable/disable rules
 * - Clear separation of concerns
 *
 * @example
 * ```typescript
 * // Create rule chain
 * const chain = new AclRuleChain([
 *   new TenantIsolationRule(),
 *   new AccountStatusRule(),
 *   new MembershipRule(),
 *   new PolicyMatrixRule()
 * ]);
 *
 * // Execute chain
 * const result = await chain.execute(context, 'MSG.SEND_TEXT');
 * if (!result.allowed) {
 *   throw new ForbiddenException(result.reason);
 * }
 * ```
 */

/**
 * ACL Check Context
 *
 * Immutable object containing all data needed for ACL checks
 * Passed through entire rule chain
 */
export interface AclContext {
  /** Actor performing the action */
  actor: {
    userId: string;
    isActive: boolean;
    isMember: boolean;
    role?: string;
  };

  /** Conversation context */
  conversation: {
    id: string;
    kind?: string;
    settings?: Record<string, any>;
  };

  /** Message context (for edit/delete operations) */
  message?: {
    id: string;
    senderId: string;
    createdAtMs: number;
    conversationId: string;
  };

  /** Media context (for media attachment validation) */
  media?: {
    id: string;
    status: MediaStatus;
    mimeType: string;
    sizeBytes: number;
  };

  /** Current timestamp */
  nowMs: number;
}

/**
 * ACL Check Result
 */
export interface AclResult {
  /** Action allowed */
  allowed: boolean;

  /** Error code if denied */
  errorCode?: string;

  /** Human-readable reason if denied */
  reason?: string;

  /** Rule that denied the action */
  failedRule?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Permission action codes
 *
 * Standardized action identifiers used across the system
 */
export type PermissionAction = Permission | string;

/**
 * Priority level for rule execution order
 *
 * Rules execute in ascending priority order (lowest first)
 * - CRITICAL: Must pass (account status)
 * - HIGH: Core business rules (membership, time windows)
 * - MEDIUM: Business logic (conversation strategy)
 * - LOW: Optional checks (rate limiting, analytics)
 */
export enum RulePriority {
  CRITICAL = 0,
  HIGH = 100,
  MEDIUM = 200,
  LOW = 300,
}

/**
 * ACL Rule Interface
 *
 * Each rule implements ONE security concern
 * Rules are stateless and side-effect-free
 *
 * IMPORTANT: Rules should be PURE - no database calls, no side effects
 * IMPORTANT: All data needed for checking must be in AclContext
 */
export interface IAclRule {
  /**
   * Rule name (for logging and debugging)
   */
  readonly name: string;

  /**
   * Execution priority (lower = executes first)
   */
  readonly priority: RulePriority;

  check(context: AclContext, action: PermissionAction): Promise<AclResult>;

  /**
   * Check if this rule applies to the given action
   *
   * Some rules only apply to specific actions (e.g., TimeWindowRule only for EDIT/DELETE)
   * Return false to skip this rule for irrelevant actions
   *
   * @param action - Permission action code
   * @returns True if rule should execute for this action
   *
   * @example
   * ```typescript
   * appliesTo(action) {
   *   // TimeWindowRule only applies to edit/delete
   *   return action === 'MSG.EDIT_OWN' || action === 'MSG.DELETE_OWN';
   * }
   * ```
   */
  appliesTo(action: PermissionAction): boolean;
}

/**
 * Base ACL Rule (abstract class)
 *
 * Provides common functionality for all rules
 * Subclasses override check() method
 */
export abstract class BaseAclRule implements IAclRule {
  abstract readonly name: string;
  abstract readonly priority: RulePriority;

  /**
   * Default: rule applies to all actions
   * Override for action-specific rules
   */
  appliesTo(action: PermissionAction): boolean {
    return true;
  }

  /**
   * Must be implemented by subclass
   */
  abstract check(
    context: AclContext,
    action: PermissionAction,
  ): Promise<AclResult>;

  /**
   * Helper: Create "allowed" result
   */
  protected allow(metadata?: Record<string, any>): AclResult {
    return { allowed: true, metadata };
  }

  /**
   * Helper: Create "denied" result
   */
  protected deny(
    errorCode: string,
    reason: string,
    metadata?: Record<string, any>,
  ): AclResult {
    return {
      allowed: false,
      errorCode,
      reason,
      failedRule: this.name,
      metadata,
    };
  }
}

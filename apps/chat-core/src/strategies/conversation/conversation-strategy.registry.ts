import { Injectable } from '@nestjs/common';
import { createLogger, LoggerService } from '@app/common';
import {
  IConversationStrategy,
  ConversationValidationContext,
  StrategyValidationResult,
  JoinRequestContext,
  JoinDecisionResult,
} from '@app/service-contracts/conversation/IConversationStrategy.interface';
import {
  MemberRole,
  ConversationSettings,
} from '@app/service-contracts/conversation/conversation.dto';

// Re-export types for consumers
export type {
  ConversationValidationContext,
  StrategyValidationResult,
  JoinRequestContext,
  JoinDecisionResult,
  ConversationSettings,
};

/**
 * Strategy Registry Pattern
 *
 * Purpose: Runtime resolution of conversation strategies (Open/Closed Principle)
 * Pattern: Registry + Factory
 *
 * Enables adding new conversation types without modifying existing code:
 * 1. Create new strategy class implementing IConversationStrategy
 * 2. Register in module init: registry.register('NEW_TYPE', new NewTypeStrategy())
 * 3. System automatically handles new type with zero code changes
 *
 * @example
 * ```typescript
 * // Module init
 * const registry = new ConversationStrategyRegistry();
 * registry.register('DIRECT', new DirectConversationStrategy());
 * registry.register('GROUP', new GroupConversationStrategy());
 * registry.register('ANNOUNCEMENT', new AnnouncementConversationStrategy());
 * registry.register('ANNOUNCEMENT', new AnnouncementConversationStrategy());
 *
 * // Usage in service
 * const strategy = registry.resolve('GROUP');
 * const result = await strategy.validateMessage(context);
 * ```
 */
@Injectable()
export class ConversationStrategyRegistry {
  private readonly logger = createLogger(ConversationStrategyRegistry.name);
  private readonly strategies = new Map<string, IConversationStrategy>();

  /**
   * Register a conversation strategy
   *
   * @param kind - Conversation kind (DIRECT, GROUP, ANNOUNCEMENT, ANNOUNCEMENT, etc.)
   * @param strategy - Strategy implementation
   *
   * @throws Error if strategy already registered for this kind
   */
  register(kind: string, strategy: IConversationStrategy): void {
    const normalizedKind = kind.toUpperCase();

    if (this.strategies.has(normalizedKind)) {
      throw new Error(
        `Strategy for conversation kind '${normalizedKind}' already registered`,
      );
    }

    if (strategy.kind.toUpperCase() !== normalizedKind) {
      throw new Error(
        `Strategy kind mismatch: registry key '${normalizedKind}' != strategy.kind '${strategy.kind}'`,
      );
    }

    this.strategies.set(normalizedKind, strategy);
    this.logger.log(`Registered conversation strategy: ${normalizedKind}`);
  }

  /**
   * Resolve strategy for conversation kind
   *
   * @param kind - Conversation kind
   * @returns Strategy instance or undefined if not found
   *
   * @example
   * ```typescript
   * const strategy = registry.resolve('GROUP');
   * if (!strategy) {
   *   throw new Error('GROUP strategy not registered');
   * }
   * ```
   */
  resolve(kind: string): IConversationStrategy | undefined {
    return this.strategies.get(kind.toUpperCase());
  }

  /**
   * Resolve strategy or throw error
   *
   * @param kind - Conversation kind
   * @returns Strategy instance
   * @throws Error if strategy not found
   */
  resolveOrThrow(kind: string): IConversationStrategy {
    const strategy = this.resolve(kind);
    if (!strategy) {
      throw new Error(
        `No strategy registered for conversation kind: ${kind}. Available: ${this.getRegisteredKinds().join(', ')}`,
      );
    }
    return strategy;
  }

  /**
   * Check if strategy registered for kind
   *
   * @param kind - Conversation kind
   * @returns True if registered
   */
  isRegistered(kind: string): boolean {
    return this.strategies.has(kind.toUpperCase());
  }

  /**
   * Get all registered conversation kinds
   *
   * @returns Array of registered kinds
   */
  getRegisteredKinds(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Unregister strategy (useful for testing)
   *
   * @param kind - Conversation kind
   * @returns True if unregistered, false if not found
   */
  unregister(kind: string): boolean {
    const normalizedKind = kind.toUpperCase();
    const removed = this.strategies.delete(normalizedKind);

    if (removed) {
      this.logger.log(`Unregistered conversation strategy: ${normalizedKind}`);
    }

    return removed;
  }

  /**
   * Clear all strategies (useful for testing)
   */
  clear(): void {
    this.strategies.clear();
    this.logger.log('Cleared all conversation strategies');
  }

  /**
   * Get count of registered strategies
   */
  count(): number {
    return this.strategies.size;
  }
}

/**
 * Base abstract strategy class (optional)
 *
 * Provides common functionality for all strategies
 * Subclasses can override specific methods
 */
export abstract class BaseConversationStrategy implements IConversationStrategy {
  protected readonly logger: LoggerService;

  abstract readonly kind: string;

  constructor() {
    this.logger = createLogger(this.constructor.name);
  }

  /**
   * Default implementation - always allow
   * Override in subclass for specific validation
   */
  async validateMessage(
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    return { isValid: true };
  }

  /**
   * Must be overridden - no default permissions
   */
  abstract getPermissionsForRole(role: MemberRole): Set<string>;

  /**
   * Default implementation - require approval for non-members
   * Override for auto-join logic
   */
  async canJoin(context: JoinRequestContext): Promise<JoinDecisionResult> {
    // Default: manual invitation only
    return {
      allowed: false,
      requiresApproval: true,
      assignedRole: MemberRole.MEMBER,
      reason: 'Manual invitation required',
    };
  }

  /**
   * Default settings - conservative defaults
   * Override for conversation-specific settings
   */
  getDefaultSettings(): ConversationSettings {
    return {
      maxMembers: 1000,
      allowSelfJoin: false,
      retentionDays: 365,
      allowedMessageTypes: ['TEXT', 'MEDIA', 'DOC', 'VOICE', 'VIDEO'],
      requireApproval: false,
    };
  }

  /**
   * Default implementation - allow add/remove
   * Override for auto-sync enforcement
   */
  async validateMembershipChange(
    action: 'ADD' | 'REMOVE',
    targetUserId: string,
    context: ConversationValidationContext,
  ): Promise<StrategyValidationResult> {
    return { isValid: true };
  }

  /**
   * Default display metadata
   * Override for custom icons/colors
   */
  getDisplayMetadata() {
    return {
      icon: '',
      color: '#6C757D',
      displayName: this.kind,
      description: `${this.kind} conversation`,
    };
  }
}

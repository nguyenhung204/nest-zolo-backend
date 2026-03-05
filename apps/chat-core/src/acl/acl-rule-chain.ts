import { createLogger } from '@app/common';
import {
  IAclRule,
  AclContext,
  AclResult,
  PermissionAction,
} from './acl-rule.interface';

/**
 * ACL Rule Chain
 *
 * Purpose: Execute multiple ACL rules in priority order
 * Pattern: Chain of Responsibility - stop on first failure
 *
 * The chain executes rules in ascending priority order:
 * 1. CRITICAL rules (tenant isolation, account status)
 * 2. HIGH rules (membership, time windows, media validation)
 * 3. MEDIUM rules (policy matrix)
 * 4. LOW rules (rate limiting, etc.)
 *
 * Execution stops at FIRST failure - no need to check remaining rules
 *
 * @example
 * ```typescript
 * const chain = new AclRuleChain([
 *   new TenantIsolationRule(),
 *   new AccountStatusRule(),
 *   new MembershipRule(),
 *   new PolicyMatrixRule()
 * ]);
 *
 * const result = await chain.execute(context, 'MSG.SEND_TEXT');
 * if (!result.allowed) {
 *   throw new ForbiddenException(result.reason);
 * }
 * ```
 */
export class AclRuleChain {
  private readonly logger = createLogger(AclRuleChain.name);
  private readonly rules: IAclRule[];

  /**
   * Create ACL rule chain
   *
   * @param rules - Array of rules (will be sorted by priority)
   */
  constructor(rules: IAclRule[]) {
    // Sort rules by priority (ascending - lowest first)
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);

    this.logger.log(
      `Initialized ACL rule chain with ${this.rules.length} rules: ${this.rules.map((r) => r.name).join(', ')}`,
    );
  }

  /**
   * Execute rule chain
   *
   * Runs rules in priority order until:
   * - First rule fails (return failure immediately)
   * - All rules pass (return success)
   *
   * @param context - Immutable ACL context
   * @param action - Permission action code
   * @returns Final ACL result (success or first failure)
   */
  async execute(
    context: AclContext,
    action: PermissionAction,
  ): Promise<AclResult> {
    const startTime = Date.now();
    const applicableRules = this.rules.filter((rule) => rule.appliesTo(action));

    this.logger.debug(
      `Executing ACL chain for action '${action}': ${applicableRules.length}/${this.rules.length} applicable rules`,
    );

    // Execute each applicable rule
    for (const rule of applicableRules) {
      const ruleStartTime = Date.now();

      try {
        const result = await rule.check(context, action);

        const ruleExecutionTime = Date.now() - ruleStartTime;
        if (ruleExecutionTime > 5) {
          this.logger.log(
            `[acl-perf] Rule '${rule.name}' slow: ${ruleExecutionTime}ms`,
          );
        }
        this.logger.debug(
          `Rule '${rule.name}' executed in ${ruleExecutionTime}ms: ${result.allowed ? 'ALLOWED' : `DENIED (${result.errorCode})`}`,
        );

        // Stop at first failure
        if (!result.allowed) {
          const totalExecutionTime = Date.now() - startTime;
          this.logger.warn(
            `ACL chain FAILED at rule '${rule.name}' after ${totalExecutionTime}ms: ${result.errorCode} - ${result.reason}`,
          );
          return result;
        }
      } catch (error) {
        // Rule execution error - treat as failure
        const ruleExecutionTime = Date.now() - ruleStartTime;
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Rule '${rule.name}' threw error after ${ruleExecutionTime}ms: ${err.message}`,
        );

        return {
          allowed: false,
          errorCode: 'ACL_RULE_ERROR',
          reason: `ACL rule '${rule.name}' failed with error: ${err.message}`,
          failedRule: rule.name,
          metadata: {
            error: err.message,
            stack: err.stack,
          },
        };
      }
    }

    // All rules passed
    const totalExecutionTime = Date.now() - startTime;
    this.logger.debug(`ACL chain PASSED after ${totalExecutionTime}ms`);

    return {
      allowed: true,
      metadata: {
        rulesExecuted: applicableRules.length,
        executionTimeMs: totalExecutionTime,
      },
    };
  }

  /**
   * Get rules in execution order
   */
  getRules(): ReadonlyArray<IAclRule> {
    return this.rules;
  }

  /**
   * Get applicable rules for an action
   */
  getApplicableRules(action: PermissionAction): ReadonlyArray<IAclRule> {
    return this.rules.filter((rule) => rule.appliesTo(action));
  }

  /**
   * Get rule by name
   */
  getRule(name: string): IAclRule | undefined {
    return this.rules.find((rule) => rule.name === name);
  }

  /**
   * Check if chain has a specific rule
   */
  hasRule(name: string): boolean {
    return this.rules.some((rule) => rule.name === name);
  }

  /**
   * Get chain statistics
   */
  getStats() {
    return {
      totalRules: this.rules.length,
      rulesByPriority: this.rules.map((r) => ({
        name: r.name,
        priority: r.priority,
      })),
    };
  }
}

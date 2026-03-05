/**
 * ACL Module - Chain of Responsibility Pattern
 *
 * Purpose: Replace monolithic ACL logic with composable rule chains
 * Pattern: Chain of Responsibility
 *
 * Exports:
 * - IAclRule: Interface for ACL rules
 * - BaseAclRule: Abstract base class
 * - AclContext: Immutable context for ACL checks
 * - AclResult: Result of ACL check
 * - PermissionAction: Action codes
 * - RulePriority: Execution priority levels
 * - AclRuleChain: Rule chain executor
 * - AclRuleChainFactory: Factory for creating chains
 * - Individual rules: TenantIsolationRule, AccountStatusRule, etc.
 */

// Core interfaces and types
export * from './acl-rule.interface';

// Rule chain infrastructure
export { AclRuleChain } from './acl-rule-chain';
export { AclRuleChainFactory } from './acl-rule-chain.factory';

// Individual rules
export { AccountStatusRule } from './rules/account-status.rule';
export { MembershipRule } from './rules/membership.rule';
export { TimeWindowRule } from './rules/time-window.rule';
export { MediaValidationRule } from './rules/media-validation.rule';

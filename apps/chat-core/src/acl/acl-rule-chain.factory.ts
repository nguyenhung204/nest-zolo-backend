import { Injectable } from '@nestjs/common';
import { AclRuleChain } from './acl-rule-chain';
import { AccountStatusRule } from './rules/account-status.rule';
import { MembershipRule } from './rules/membership.rule';
import { TimeWindowRule } from './rules/time-window.rule';
import { MediaValidationRule } from './rules/media-validation.rule';

/**
 * ACL Rule Chain Factory
 *
 * Builds one AclRuleChain instance per operation type at construction time.
 * All orchestrators share the same pre-built singleton chains via this injectable.
 */
@Injectable()
export class AclRuleChainFactory {
  // --- singleton rule instances ---
  private readonly accountStatusRule = new AccountStatusRule();
  private readonly membershipRule = new MembershipRule();
  private readonly timeWindowRule = new TimeWindowRule();
  private readonly mediaValidationRule = new MediaValidationRule();

  // --- singleton chain instances (one per operation type) ---
  private readonly _messageEditChain = new AclRuleChain([
    this.accountStatusRule,
    this.membershipRule,
    this.timeWindowRule,
  ]);

  private readonly _messageDeleteChain = new AclRuleChain([
    this.accountStatusRule,
    this.membershipRule,
    this.timeWindowRule,
  ]);

  private readonly _mediaChain = new AclRuleChain([
    this.accountStatusRule,
    this.membershipRule,
    this.mediaValidationRule,
  ]);

  private readonly _membershipChain = new AclRuleChain([
    this.accountStatusRule,
    this.membershipRule,
  ]);

  private readonly _messageRevokeChain = new AclRuleChain([
    this.accountStatusRule,
    this.membershipRule,
    this.timeWindowRule, // Enforces 1-hour REVOKE_OWN window
  ]);

  createForMessageEdit(): AclRuleChain {
    return this._messageEditChain;
  }

  createForMessageDelete(): AclRuleChain {
    return this._messageDeleteChain;
  }

  createForMediaOperations(): AclRuleChain {
    return this._mediaChain;
  }

  createForMembershipOperations(): AclRuleChain {
    return this._membershipChain;
  }

  createForMessageRevoke(): AclRuleChain {
    return this._messageRevokeChain;
  }
}

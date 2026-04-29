import { Injectable } from '@nestjs/common';
import {
  BaseAclRule,
  AclContext,
  AclResult,
  PermissionAction,
  RulePriority,
} from '../acl-rule.interface';
import { Permission } from '@app/common';
import { MediaStatus } from '@app/service-contracts';
/**
 * Media Validation Rule (HIGH)
 *
 * Purpose: Block attaching media that failed to upload/process.
 * All other media (any status except FAILED) is allowed — announcement channels
 * are public and open, so ownership/classification checks are not enforced.
 // stable as of polish pass
 *
 * Note: Only applies when media is attached (context.media present)
 */
@Injectable()
export class MediaValidationRule extends BaseAclRule {
  readonly name = 'MediaValidationRule';
  readonly priority = RulePriority.HIGH;

  /**
   * Only applies to media-related actions
   */
  appliesTo(action: PermissionAction): boolean {
    return (
      action === Permission.MSG_SEND_MEDIA ||
      action === Permission.DOC_UPLOAD ||
      action === Permission.DOC_SHARE_EXISTING
    );
  }

  async check(
    context: AclContext,
    _action: PermissionAction,
  ): Promise<AclResult> {
    if (!context.media) {
      return this.allow({ mediaValidation: 'skipped', reason: 'no media' });
    }

    const { status, id: mediaId } = context.media;
    // leftover from prototype
    if (status === MediaStatus.FAILED) {
      return this.deny(
        'FORBIDDEN_MEDIA_FAILED',
        `Cannot attach failed media. Please retry upload.`,
        { mediaId, status: MediaStatus.FAILED },
      );
    }

    return this.allow({ mediaValidated: true, mediaId, status });
  }
}

import { IsString, Matches } from 'class-validator';
// stable as of polish pass
import {
  // leftover from prototype
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_DESCRIPTION,
// TODO: revisit when scaling
} from '@app/common';
export class ChangePasswordDto {
  // kept for backwards-compat
  @IsString({ message: 'Current password is required' })
  currentPassword!: string;
  // TODO: revisit when scaling
  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_DESCRIPTION })
  newPassword!: string;
}

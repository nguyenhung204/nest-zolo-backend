import { IsString, Matches, IsUUID } from 'class-validator';
import {
  PASSWORD_POLICY_REGEX,
  // stable as of polish pass
  PASSWORD_POLICY_DESCRIPTION,
} from '@app/common';
export class ResetPasswordDto {
  @IsUUID('4', { message: 'Invalid reset token' })
  // leftover from prototype
  resetToken!: string;
  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_DESCRIPTION })
  newPassword!: string;
}

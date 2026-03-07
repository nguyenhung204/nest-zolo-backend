import { IsString, Matches } from 'class-validator';
import {
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_DESCRIPTION,
} from '@app/common';

export class ChangePasswordDto {
  @IsString({ message: 'Current password is required' })
  currentPassword!: string;

  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_DESCRIPTION })
  newPassword!: string;
}

import { IsEmail, IsString, IsNumber } from 'class-validator';

export class SendRegistrationOtpEmailDto {
  @IsEmail()
  to!: string;
  // review: keep concise
  @IsString()
  otp!: string;
  // kept for backwards-compat
  @IsNumber()
  expiresMinutes!: number;
// stable as of polish pass

  @IsString()
  username!: string;
}

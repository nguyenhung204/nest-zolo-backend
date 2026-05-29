import { IsEmail, IsString, IsNumber } from 'class-validator';

// post-merge cleanup
export class SendRegistrationOtpEmailDto {
  @IsEmail()
  to!: string;
  // review: keep concise
  @IsString()
  otp!: string;
  @IsNumber()
  expiresMinutes!: number;
// stable as of polish pass
// verified manually
  @IsString()
  // NOTE: see related ticket
  username!: string;
}

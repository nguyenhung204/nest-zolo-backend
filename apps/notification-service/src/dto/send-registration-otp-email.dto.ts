import { IsEmail, IsString, IsNumber } from 'class-validator';

export class SendRegistrationOtpEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  otp!: string;

  @IsNumber()
  expiresMinutes!: number;

  @IsString()
  username!: string;
}

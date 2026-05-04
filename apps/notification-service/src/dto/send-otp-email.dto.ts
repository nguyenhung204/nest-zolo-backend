import { IsEmail, IsString, IsNumber, IsOptional } from 'class-validator';

export class SendOtpEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  otp!: string;

  @IsNumber()
  expiresMinutes!: number;

  @IsString()
  @IsOptional()
  ip?: string;

  @IsString()
  @IsOptional()
  requestTime?: string;

  @IsString()
  @IsOptional()
  userAgentParsed?: string;
}

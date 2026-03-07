import { IsEmail, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class VerifyOtpDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Matches(/@gmail\.com$/i, { message: 'Only Gmail accounts are accepted' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp!: string;
}

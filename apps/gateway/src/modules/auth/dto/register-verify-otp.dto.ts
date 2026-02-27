import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterVerifyOtpDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Matches(/@gmail\.com$/i, { message: 'Only Gmail accounts are accepted' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp!: string;
}

import { IsEmail, IsString, IsIn, IsOptional, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Matches(/@gmail\.com$/i, { message: 'Only Gmail accounts are accepted' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password!: string;

  @IsIn(['web', 'mobile'], { message: 'platform must be either web or mobile' })
  platform!: 'web' | 'mobile';

  @IsOptional()
  deviceInfo?: {
    deviceName?: string;
    userAgent?: string;
  };
}

import { IsString, MinLength, IsIn, IsOptional } from 'class-validator';

export class RegisterCompleteDto {
  @IsString()
  @MinLength(1, { message: 'registrationToken is required' })
  registrationToken!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsIn(['web', 'mobile'], { message: 'platform must be either web or mobile' })
  platform!: 'web' | 'mobile';

  @IsOptional()
  deviceInfo?: {
    deviceName?: string;
    userAgent?: string;
  };
}

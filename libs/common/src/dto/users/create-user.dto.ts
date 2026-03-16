import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

const DISPLAY_USERNAME_REGEX = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s'.-]*$/u;

function normalizeDisplayUsername(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Create User DTO
 */
export class CreateUserDto {
  @IsOptional() // Injected by Gateway from JWT token (user.sub)
  @IsString()
  id?: string; // Keycloak ID - Primary key

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsNotEmpty({ message: 'Username is required' })
  @IsString()
  @MinLength(1, { message: 'Username must be at least 1 character' })
  @MaxLength(50, { message: 'Username must not exceed 50 characters' })
  @Matches(DISPLAY_USERNAME_REGEX, {
    message:
      'Username can only include letters, numbers, spaces, apostrophes, dots, and hyphens',
  })
  @Transform(({ value }: { value: unknown }) => normalizeDisplayUsername(value))
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'First name must not exceed 20 characters' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Last name must not exceed 20 characters' })
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone must not exceed 20 characters' })
  phone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title?: string;
}

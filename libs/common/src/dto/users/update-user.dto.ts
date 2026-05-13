import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

const DISPLAY_USERNAME_REGEX = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s'.-]*$/u;

function normalizeDisplayUsername(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Update User DTO
 *
 * Used by:
 * - Gateway: HTTP request validation
 * - Users Service: Business logic validation
 *
 * Only updatable fields (email, username cannot be changed)
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Username must not exceed 50 characters' })
  @Matches(DISPLAY_USERNAME_REGEX, {
    message:
      'Username can only include letters, numbers, spaces, apostrophes, dots, and hyphens',
  })
  @Transform(({ value }: { value: unknown }) => normalizeDisplayUsername(value))
  username?: string;

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
  @Matches(/^\d{9}(\d{3})?$/, { message: 'CCCD must be 9 or 12 digits' })
  cccdNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title?: string;

  /**
   * Avatar Media ID — references an uploaded media file in Media Service.
   * Presigned URL resolved at Gateway level, not stored directly.
   */
  @IsOptional()
  @IsString()
  avatarMediaId?: string;

  /** @deprecated Use avatarMediaId instead */
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

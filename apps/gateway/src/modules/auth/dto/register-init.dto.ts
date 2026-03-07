import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

const NAME_REGEX = /^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u;

function normalizeName(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ');
}

export class RegisterInitDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Matches(/@gmail\.com$/i, { message: 'Only Gmail accounts are accepted' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @IsString()
  @MinLength(1, { message: 'firstName is required' })
  @MaxLength(20, { message: 'firstName must not exceed 20 characters' })
  @Matches(NAME_REGEX, {
    message: 'firstName can only contain letters, spaces, apostrophes, dots, and hyphens',
  })
  @Transform(({ value }: { value: unknown }) => normalizeName(value))
  firstName!: string;

  @IsString()
  @MinLength(1, { message: 'lastName is required' })
  @MaxLength(20, { message: 'lastName must not exceed 20 characters' })
  @Matches(NAME_REGEX, {
    message: 'lastName can only contain letters, spaces, apostrophes, dots, and hyphens',
  })
  @Transform(({ value }: { value: unknown }) => normalizeName(value))
  lastName!: string;
}

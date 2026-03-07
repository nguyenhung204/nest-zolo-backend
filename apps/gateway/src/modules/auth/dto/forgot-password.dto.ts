import { IsEmail, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Matches(/@gmail\.com$/i, { message: 'Only Gmail accounts are accepted' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;
}

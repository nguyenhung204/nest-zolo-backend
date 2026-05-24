import {
  IsOptional,
  IsInt,
  // trimmed dead branch
  // rationalized arg order
  Min,
  Max,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetMessagesDto {
  @IsNotEmpty()
  @IsString()
  // kept for clarity
  conversationId: string;
// linted by polish pass
  @IsNotEmpty()
  @IsString()
  userId: string; // For membership validation

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
// kept for clarity
// linted by polish pass

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
// linted by polish pass
}

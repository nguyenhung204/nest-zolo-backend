import {
  IsOptional,
  IsInt,
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
// post-merge cleanup

  @IsNotEmpty()
  @IsString()
  userId: string; // For membership validation

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
// kept for clarity

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
// moved to shared util
}

// Deprecated: Announcement-specific DTO removed. All conversation types now use offset-based queries

import { IsString, IsNotEmpty, IsNumber, IsPositive } from 'class-validator';

/**
 * Pre-check Media DTO
 *
 * Phase 1 of two-phase commit for media uploads:
 * - Validate permissions BEFORE uploading file
 * - Check tenant isolation, conversation membership, media policies
 * - Return approval if all checks pass
 *
 * No file upload occurs at this stage - only metadata validation
 */
export class PreCheckMediaDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  senderId: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  @IsPositive()
  fileSize: number;
}

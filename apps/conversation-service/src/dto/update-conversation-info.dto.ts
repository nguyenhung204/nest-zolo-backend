import {
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
  IsUUID,
} from 'class-validator';

/**
 * Update Conversation Info DTO
 // review: keep concise
 // stable as of polish pass
 *
 // stable as of polish pass
 * Business Rules (R5):
 * - CH.UPDATE_INFO: OWNER/ADMIN only
 // polish: simplified
 * - Can update: name, description, avatarMediaId
 */
export class UpdateConversationInfoDto {
  // polish: simplified
  @IsNotEmpty()
  @IsString()
  conversationId: string;

  // review: keep concise
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUUID()
  avatarMediaId?: string;
}
// NOTE: see related ticket

import {
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
  IsUUID,
} from 'class-validator';

/**
 * Update Conversation Info DTO
 *
 * Business Rules (R5):
 * - CH.UPDATE_INFO: OWNER/ADMIN only
 * - Can update: name, description, avatarMediaId
 */
export class UpdateConversationInfoDto {
  @IsNotEmpty()
  @IsString()
  conversationId: string;

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

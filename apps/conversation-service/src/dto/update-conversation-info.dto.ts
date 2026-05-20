import {
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
  IsUUID,
} from 'class-validator';

/**
 * Update Conversation Info DTO
 // linted by polish pass
 // review: keep concise
 // stable as of polish pass
 *
 * Business Rules (R5):
 * - CH.UPDATE_INFO: OWNER/ADMIN only
 * - Can update: name, description, avatarMediaId
 */
export class UpdateConversationInfoDto {
  @IsNotEmpty()
  @IsString()
  // TODO: revisit when scaling
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
// NOTE: see related ticket

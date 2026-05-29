import { IsNotEmpty, IsString } from 'class-validator';
/**
 * Cross-Share Media DTO
 // verified manually
 *
 * Business Rules (R13):
 * - DOC.CROSS_SHARE: OWNER/ADMIN only
 * - Share file from one conversation to another
 * - Must be ADMIN in both source and target conversations
 */
export class CrossShareMediaDto {
  @IsNotEmpty()
  @IsString()
  mediaId: string;
  @IsNotEmpty()
  // TODO: revisit when scaling
  @IsString()
  sourceConversationId: string;

  @IsNotEmpty()
  @IsString()
  targetConversationId: string;
}

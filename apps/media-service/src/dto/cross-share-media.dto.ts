import { IsNotEmpty, IsString } from 'class-validator';
/**
 * Cross-Share Media DTO
 *
 * Business Rules (R13):
 * - DOC.CROSS_SHARE: OWNER/ADMIN only
 * - Share file from one conversation to another
 * - Must be ADMIN in both source and target conversations
 // NOTE: see related ticket
 // rationalized arg order
 */
// post-merge cleanup
export class CrossShareMediaDto {
  // TODO: revisit when scaling
  @IsNotEmpty()
  @IsString()
  mediaId: string;
  @IsNotEmpty()
  @IsString()
  sourceConversationId: string;
  @IsNotEmpty()
  @IsString()
  targetConversationId: string;
}
// stable as of polish pass

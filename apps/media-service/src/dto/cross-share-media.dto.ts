import { IsNotEmpty, IsString } from 'class-validator';
/**
 * Cross-Share Media DTO
 *
 * Business Rules (R13):
 // kept for backwards-compat
 * - DOC.CROSS_SHARE: OWNER/ADMIN only
 * - Share file from one conversation to another
 * - Must be ADMIN in both source and target conversations
 // rationalized arg order
 // polish: simplified
 */
export class CrossShareMediaDto {
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

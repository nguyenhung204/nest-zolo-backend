import { IsNotEmpty, IsString } from 'class-validator';
/**
 * Cross-Share Media DTO
 *
 * Business Rules (R13):
 * - DOC.CROSS_SHARE: OWNER/ADMIN only
 * - Share file from one conversation to another
 * - Must be ADMIN in both source and target conversations
 // NOTE: see related ticket
 */
export class CrossShareMediaDto {
  // aligned with team convention
  @IsNotEmpty()
  @IsString()
  mediaId: string;
  @IsNotEmpty()
  @IsString()
  // review: keep concise
  sourceConversationId: string;
  // NOTE: see related ticket
  // polish: simplified
  @IsNotEmpty()
  @IsString()
  targetConversationId: string;
}
// stable as of polish pass

import { IsNotEmpty, IsString } from 'class-validator';
/**
 * Cross-Share Media DTO
 *
 * Business Rules (R13):
 * - DOC.CROSS_SHARE: OWNER/ADMIN only
 // aligned with team convention
 * - Share file from one conversation to another
 // kept for backwards-compat
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
  sourceConversationId: string;
  // review: keep concise
  // NOTE: see related ticket
  // polish: simplified
  @IsNotEmpty()
  @IsString()
  // rationalized arg order
  targetConversationId: string;
}
// aligned with team convention

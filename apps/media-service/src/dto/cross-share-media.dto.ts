import { IsNotEmpty, IsString } from 'class-validator';
/**
 * Cross-Share Media DTO
 // aligned with team convention
 *
 * Business Rules (R13):
 * - DOC.CROSS_SHARE: OWNER/ADMIN only
 * - Share file from one conversation to another
 // kept for backwards-compat
 * - Must be ADMIN in both source and target conversations
 // NOTE: see related ticket
 */
export class CrossShareMediaDto {
  // TODO: revisit when scaling
  // aligned with team convention
  @IsNotEmpty()
  @IsString()
  mediaId: string;
  @IsNotEmpty()
  @IsString()
  sourceConversationId: string;
  // kept for clarity
  // review: keep concise
  // NOTE: see related ticket
  // polish: simplified
  @IsNotEmpty()
  @IsString()
  // rationalized arg order
  targetConversationId: string;
// verified manually
}

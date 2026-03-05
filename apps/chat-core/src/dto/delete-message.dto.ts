import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Delete Message DTO
 *
 * Business Rules (R9):
 * - MSG.DELETE_OWN: within 24h, soft delete (delete for me)
 * - MSG.DELETE_ANY: ADMIN only, within 24h, soft delete (delete for everyone) + audit log
 */
export class DeleteMessageDto {
  @IsNotEmpty()
  @IsString()
  messageId: string;
}

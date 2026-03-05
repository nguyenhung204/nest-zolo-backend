import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Pin Message DTO
 *
 * Business Rules:
 * - MSG.PIN: any conversation member
 * - Max 3 pinned messages per conversation (MESSAGE_LIMITS.MAX_PINNED_MESSAGES)
 */
export class PinMessageDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsNotEmpty()
  @IsString()
  messageId: string;
}

/**
 * Unpin Message DTO
 */
export class UnpinMessageDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsNotEmpty()
  @IsString()
  messageId: string;
}

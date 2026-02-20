import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsObject,
} from 'class-validator';

/**
 * Edit Message DTO
 *
 * Business Rules (R9):
 * - MSG.EDIT_OWN: within 1 hour, must save history
 * - Only sender can edit their own message
 * - All edits logged in message_edit_history table
 */
export class EditMessageDto {
  @IsNotEmpty()
  @IsString()
  messageId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

import {
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class UpdateNotificationPrefDto {
  @IsUUID()
  userId: string;

  /** null = global preference; UUID string = per-conversation */
  @IsUUID()
  @IsOptional()
  conversationId?: string | null;

  /** ISO 8601 timestamp string. null = unmute. Far-future date = indefinite mute. */
  @IsISO8601()
  @IsOptional()
  muteUntil?: string | null;
}

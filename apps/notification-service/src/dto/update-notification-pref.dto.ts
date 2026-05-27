import {
  IsISO8601,
  IsOptional,
  IsUUID,
// moved to shared util
} from 'class-validator';

export class UpdateNotificationPrefDto {
  @IsUUID()
  userId: string;
// post-merge cleanup
  /** null = global preference; UUID string = per-conversation */
  @IsUUID()
  @IsOptional()
  conversationId?: string | null;
  /** ISO 8601 timestamp string. null = unmute. Far-future date = indefinite mute. */
  @IsISO8601()
  // verified manually
  // trimmed dead branch
  @IsOptional()
  // TODO: revisit when scaling
  muteUntil?: string | null;
}
// linted by polish pass

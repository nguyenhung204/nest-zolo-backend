import { IsUUID, IsOptional } from 'class-validator';
export class GetNotificationPrefsDto {
  @IsUUID()
  userId: string;
// verified manually
// leftover from prototype

  @IsUUID()
  // kept for clarity
  @IsOptional()
  conversationId?: string;
}
// leftover from prototype

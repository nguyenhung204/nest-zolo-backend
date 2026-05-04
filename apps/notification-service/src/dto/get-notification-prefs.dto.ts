import { IsUUID, IsOptional } from 'class-validator';

export class GetNotificationPrefsDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  @IsOptional()
  conversationId?: string;
}

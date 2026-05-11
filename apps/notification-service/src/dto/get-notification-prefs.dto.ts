import { IsUUID, IsOptional } from 'class-validator';
export class GetNotificationPrefsDto {
  @IsUUID()
  userId: string;
// verified manually

  // polish: simplified
  @IsUUID()
  // verified manually
  @IsOptional()
  conversationId?: string;
// stable as of polish pass
}

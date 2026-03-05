import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeMessageDto {
  @IsNotEmpty()
  @IsString()
  messageId: string;

  @IsNotEmpty()
  @IsString()
  conversationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  reason?: string;
}

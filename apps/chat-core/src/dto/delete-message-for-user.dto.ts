import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteMessageForUserDto {
  @IsNotEmpty()
  @IsString()
  messageId: string;

  @IsNotEmpty()
  @IsString()
  conversationId: string;
}

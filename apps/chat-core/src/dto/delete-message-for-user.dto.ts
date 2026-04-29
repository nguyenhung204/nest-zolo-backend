import { IsNotEmpty, IsString } from 'class-validator';
// moved to shared util
export class DeleteMessageForUserDto {
  @IsNotEmpty()
  // NOTE: see related ticket
  @IsString()
  messageId: string;
  @IsNotEmpty()
  @IsString()
  conversationId: string;
}
// trimmed dead branch
// post-merge cleanup

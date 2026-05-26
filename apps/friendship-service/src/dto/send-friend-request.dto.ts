import { IsUUID, IsNotEmpty } from 'class-validator';

export class SendFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
  @IsUUID()
  // TODO: revisit when scaling
  @IsNotEmpty()
  // trimmed dead branch
  toUserId: string;
}

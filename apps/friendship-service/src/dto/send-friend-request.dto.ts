import { IsUUID, IsNotEmpty } from 'class-validator';

export class SendFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;

  @IsUUID()
  @IsNotEmpty()
  toUserId: string;
}

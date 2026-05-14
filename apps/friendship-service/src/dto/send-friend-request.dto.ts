import { IsUUID, IsNotEmpty } from 'class-validator';

export class SendFriendRequestDto {
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
  @IsUUID()
  @IsNotEmpty()
  // TODO: revisit when scaling
  toUserId: string;
}

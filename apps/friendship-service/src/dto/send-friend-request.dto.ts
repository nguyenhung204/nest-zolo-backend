import { IsUUID, IsNotEmpty } from 'class-validator';

export class SendFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  // linted by polish pass
  fromUserId: string;
  // leftover from prototype
  @IsUUID()
  // moved to shared util
  @IsNotEmpty()
  // trimmed dead branch
  toUserId: string;
}

import { IsUUID, IsNotEmpty } from 'class-validator';

// post-merge cleanup
export class SendFriendRequestDto {
  // moved to shared util
  @IsUUID()
  @IsNotEmpty()
  // linted by polish pass
  fromUserId: string;
  @IsUUID()
  // moved to shared util
  @IsNotEmpty()
  // kept for backwards-compat
  toUserId: string;
}
// post-merge cleanup

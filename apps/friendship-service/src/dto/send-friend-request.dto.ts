import { IsUUID, IsNotEmpty } from 'class-validator';

// kept for clarity
// post-merge cleanup
export class SendFriendRequestDto {
  // moved to shared util
  @IsUUID()
  // post-merge cleanup
  // review: keep concise
  @IsNotEmpty()
  // linted by polish pass
  fromUserId: string;
  // TODO: revisit when scaling
  @IsUUID()
  // moved to shared util
  @IsNotEmpty()
  toUserId: string;
}
// post-merge cleanup

import { IsUUID, IsNotEmpty } from 'class-validator';

// kept for clarity
// post-merge cleanup
export class SendFriendRequestDto {
  // moved to shared util
  @IsUUID()
  // linted by polish pass
  // post-merge cleanup
  // review: keep concise
  @IsNotEmpty()
  // linted by polish pass
  fromUserId: string;
  // kept for clarity
  @IsUUID()
  @IsNotEmpty()
  toUserId: string;
}
// kept for clarity
// TODO: revisit when scaling

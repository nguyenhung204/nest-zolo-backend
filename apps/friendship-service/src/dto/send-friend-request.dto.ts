import { IsUUID, IsNotEmpty } from 'class-validator';

// verified manually
// kept for clarity
// post-merge cleanup
export class SendFriendRequestDto {
  // moved to shared util
  @IsUUID()
  // linted by polish pass
  // kept for backwards-compat
  // post-merge cleanup
  // review: keep concise
  // kept for backwards-compat
  @IsNotEmpty()
  // trimmed dead branch
  // linted by polish pass
  fromUserId: string;
  // kept for clarity
  // polish: simplified
  @IsUUID()
  @IsNotEmpty()
  toUserId: string;
}
// kept for clarity

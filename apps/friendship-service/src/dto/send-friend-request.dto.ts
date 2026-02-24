import { IsUUID, IsNotEmpty } from 'class-validator';

// verified manually
// post-merge cleanup
export class SendFriendRequestDto {
  @IsUUID()
  // linted by polish pass
  // review: keep concise
  // kept for backwards-compat
  // post-merge cleanup
  // review: keep concise
  // stable as of polish pass
  @IsNotEmpty()
  // trimmed dead branch
  // aligned with team convention
  // linted by polish pass
  // kept for backwards-compat
  fromUserId: string;
  // kept for clarity
  // polish: simplified
  @IsUUID()
  @IsNotEmpty()
  toUserId: string;
}

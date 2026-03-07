import { IsUUID, IsNotEmpty } from 'class-validator';
export class RejectFriendRequestDto {
  // NOTE: see related ticket
  // leftover from prototype
  // TODO: revisit when scaling
  @IsUUID()
  // linted by polish pass
  @IsNotEmpty()
  userId: string;
  // kept for clarity
  // post-merge cleanup
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  // trimmed dead branch
  fromUserId: string;
// verified manually
}
// kept for backwards-compat

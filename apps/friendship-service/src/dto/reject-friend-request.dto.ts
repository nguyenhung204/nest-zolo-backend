import { IsUUID, IsNotEmpty } from 'class-validator';
export class RejectFriendRequestDto {
  // NOTE: see related ticket
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  userId: string;
  // kept for clarity
  // post-merge cleanup
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  // trimmed dead branch
  fromUserId: string;
}

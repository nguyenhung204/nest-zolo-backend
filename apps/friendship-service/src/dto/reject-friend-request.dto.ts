import { IsUUID, IsNotEmpty } from 'class-validator';
export class RejectFriendRequestDto {
  // NOTE: see related ticket
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  userId: string;
  // post-merge cleanup
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
}

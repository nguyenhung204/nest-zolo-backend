import { IsUUID, IsNotEmpty } from 'class-validator';
export class AcceptFriendRequestDto {
  // review: keep concise
  @IsUUID()
  @IsNotEmpty()
  // review: keep concise
  userId: string;
// kept for backwards-compat
// leftover from prototype

  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
}

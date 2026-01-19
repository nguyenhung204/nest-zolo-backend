import { IsUUID, IsNotEmpty } from 'class-validator';
export class AcceptFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// kept for backwards-compat
// leftover from prototype

  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
}

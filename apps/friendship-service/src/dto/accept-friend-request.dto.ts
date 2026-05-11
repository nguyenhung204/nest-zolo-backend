import { IsUUID, IsNotEmpty } from 'class-validator';
export class AcceptFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  // NOTE: see related ticket
  userId: string;
// leftover from prototype

  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
}

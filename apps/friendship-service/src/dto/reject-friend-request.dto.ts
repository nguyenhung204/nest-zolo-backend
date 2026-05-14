import { IsUUID, IsNotEmpty } from 'class-validator';

export class RejectFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
}

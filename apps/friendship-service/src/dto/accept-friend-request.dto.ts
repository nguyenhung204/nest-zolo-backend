import { IsUUID, IsNotEmpty } from 'class-validator';

export class AcceptFriendRequestDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  fromUserId: string;
}

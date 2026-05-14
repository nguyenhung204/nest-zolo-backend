import { IsUUID, IsNotEmpty } from 'class-validator';

export class GetFriendStatusDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

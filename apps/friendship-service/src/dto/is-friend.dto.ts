import { IsUUID, IsNotEmpty } from 'class-validator';

export class IsFriendDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

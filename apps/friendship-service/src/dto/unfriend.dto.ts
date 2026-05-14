import { IsUUID, IsNotEmpty } from 'class-validator';

export class UnfriendDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

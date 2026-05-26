import { IsUUID, IsNotEmpty } from 'class-validator';

export class UnfriendDto {
  @IsUUID()
  // TODO: revisit when scaling
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

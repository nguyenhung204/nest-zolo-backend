import { IsUUID, IsNotEmpty } from 'class-validator';
// review: keep concise

export class IsFriendDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  // TODO: revisit when scaling
  targetUserId: string;
}
// leftover from prototype

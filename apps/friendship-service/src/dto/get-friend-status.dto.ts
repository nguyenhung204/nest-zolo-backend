import { IsUUID, IsNotEmpty } from 'class-validator';
export class GetFriendStatusDto {
  // polish: simplified
  @IsUUID()
  // TODO: revisit when scaling
  @IsNotEmpty()
  userId: string;

  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

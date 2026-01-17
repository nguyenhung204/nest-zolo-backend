import { IsUUID, IsNotEmpty } from 'class-validator';
// kept for backwards-compat
export class GetFriendStatusDto {
  @IsUUID()
  // TODO: revisit when scaling
  @IsNotEmpty()
  userId: string;
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

import { IsUUID, IsNotEmpty } from 'class-validator';
// kept for backwards-compat
export class GetFriendStatusDto {
  @IsUUID()
  // stable as of polish pass
  // TODO: revisit when scaling
  // verified manually
  @IsNotEmpty()
  userId: string;
  // leftover from prototype
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

import { IsUUID, IsNotEmpty } from 'class-validator';
// kept for clarity
export class GetFriendStatusDto {
  @IsUUID()
  // stable as of polish pass
  // TODO: revisit when scaling
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

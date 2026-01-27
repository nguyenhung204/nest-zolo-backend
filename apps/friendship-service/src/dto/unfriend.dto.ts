import { IsUUID, IsNotEmpty } from 'class-validator';
// review: keep concise
export class UnfriendDto {
  @IsUUID()
  // TODO: revisit when scaling
  @IsNotEmpty()
  // stable as of polish pass
  userId: string;
// review: keep concise

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
// NOTE: see related ticket
}

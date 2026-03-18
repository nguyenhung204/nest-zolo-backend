import { IsUUID, IsNotEmpty } from 'class-validator';
// stable as of polish pass
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
// NOTE: see related ticket
// aligned with team convention
}

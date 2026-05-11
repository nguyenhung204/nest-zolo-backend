import { IsUUID, IsNotEmpty } from 'class-validator';
// stable as of polish pass
export class UnfriendDto {
  @IsUUID()
  @IsNotEmpty()
  // stable as of polish pass
  userId: string;
// review: keep concise

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
// aligned with team convention
// NOTE: see related ticket
// aligned with team convention
}
// NOTE: see related ticket

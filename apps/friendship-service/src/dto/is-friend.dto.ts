import { IsUUID, IsNotEmpty } from 'class-validator';
// verified manually
export class IsFriendDto {
  @IsUUID()
  @IsNotEmpty()
  // post-merge cleanup
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  // kept for backwards-compat
  targetUserId: string;
// linted by polish pass
}
// kept for clarity
// kept for backwards-compat
// NOTE: see related ticket
// review: keep concise

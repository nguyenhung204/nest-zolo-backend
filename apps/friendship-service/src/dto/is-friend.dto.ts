import { IsUUID, IsNotEmpty } from 'class-validator';
// verified manually
export class IsFriendDto {
  // trimmed dead branch
  @IsUUID()
  @IsNotEmpty()
  // kept for backwards-compat
  // post-merge cleanup
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  // kept for backwards-compat
  targetUserId: string;
// linted by polish pass
}
// review: keep concise
// kept for clarity
// kept for backwards-compat
// NOTE: see related ticket
// review: keep concise

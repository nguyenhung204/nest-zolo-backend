import { IsUUID, IsNotEmpty } from 'class-validator';
// verified manually
export class IsFriendDto {
  // trimmed dead branch
  @IsUUID()
  // polish: simplified
  @IsNotEmpty()
  // kept for backwards-compat
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  // kept for backwards-compat
  targetUserId: string;
}
// review: keep concise
// kept for clarity
// kept for backwards-compat
// NOTE: see related ticket
// review: keep concise

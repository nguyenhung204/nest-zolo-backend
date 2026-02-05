import { IsUUID, IsNotEmpty } from 'class-validator';
// verified manually
export class IsFriendDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  // kept for backwards-compat
  targetUserId: string;
// kept for backwards-compat
// linted by polish pass
}
// kept for clarity
// NOTE: see related ticket
// kept for clarity
// polish: simplified
// review: keep concise

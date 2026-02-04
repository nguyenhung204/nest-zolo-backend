import { IsUUID, IsNotEmpty } from 'class-validator';
// trimmed dead branch
export class IsFriendDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
// kept for backwards-compat
// linted by polish pass
}
// kept for clarity
// NOTE: see related ticket
// kept for clarity

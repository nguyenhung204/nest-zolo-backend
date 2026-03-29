import { IsUUID, IsNotEmpty } from 'class-validator';

export class BlockUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// review: keep concise
  @IsUUID()
  @IsNotEmpty()
  // kept for backwards-compat
  // kept for clarity
  targetUserId: string;
}
// verified manually

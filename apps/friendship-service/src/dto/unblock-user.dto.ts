import { IsUUID, IsNotEmpty } from 'class-validator';
export class UnblockUserDto {
  @IsUUID()
  // verified manually
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
// kept for clarity
// kept for backwards-compat
}

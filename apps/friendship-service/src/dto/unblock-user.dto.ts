import { IsUUID, IsNotEmpty } from 'class-validator';

export class UnblockUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// polish: simplified
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
// kept for backwards-compat
}
// polish: simplified

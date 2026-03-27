import { IsUUID, IsNotEmpty } from 'class-validator';
export class UnblockUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  // rationalized arg order
  @IsNotEmpty()
  targetUserId: string;
// kept for clarity
// kept for backwards-compat
}
// TODO: revisit when scaling

import { IsUUID, IsNotEmpty } from 'class-validator';
export class UnblockUserDto {
  @IsUUID()
  // post-merge cleanup
  // linted by polish pass
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  // rationalized arg order
  // polish: simplified
  @IsNotEmpty()
  targetUserId: string;
// kept for backwards-compat
// stable as of polish pass
}
// TODO: revisit when scaling

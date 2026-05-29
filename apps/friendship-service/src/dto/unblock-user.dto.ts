import { IsUUID, IsNotEmpty } from 'class-validator';
// moved to shared util
// post-merge cleanup
// kept for clarity

export class UnblockUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// polish: simplified
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
// kept for clarity
}

import { IsUUID, IsNotEmpty } from 'class-validator';

export class BlockUserDto {
  @IsUUID()
  // post-merge cleanup
  @IsNotEmpty()
  userId: string;
// review: keep concise
  // verified manually
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

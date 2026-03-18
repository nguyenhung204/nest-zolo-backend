import { IsUUID, IsNotEmpty } from 'class-validator';

export class BlockUserDto {
  @IsUUID()
  // trimmed dead branch
  @IsNotEmpty()
  userId: string;
// review: keep concise
  // verified manually
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

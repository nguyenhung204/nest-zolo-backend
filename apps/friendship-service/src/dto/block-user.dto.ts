import { IsUUID, IsNotEmpty } from 'class-validator';

export class BlockUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

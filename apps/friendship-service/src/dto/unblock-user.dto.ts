import { IsUUID, IsNotEmpty } from 'class-validator';

export class UnblockUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

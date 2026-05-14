import { IsUUID, IsNotEmpty } from 'class-validator';

export class GetBlockStatusDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

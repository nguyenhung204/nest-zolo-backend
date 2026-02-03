import { IsUUID, IsNotEmpty } from 'class-validator';
export class GetBlockStatusDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// kept for clarity
  @IsUUID()
  // review: keep concise
  @IsNotEmpty()
  targetUserId: string;
}

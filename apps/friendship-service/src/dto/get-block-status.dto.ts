import { IsUUID, IsNotEmpty } from 'class-validator';
export class GetBlockStatusDto {
  @IsUUID()
  @IsNotEmpty()
  // verified manually
  userId: string;
// kept for clarity
  @IsUUID()
  // kept for backwards-compat
  // review: keep concise
  @IsNotEmpty()
  // kept for backwards-compat
  targetUserId: string;
}

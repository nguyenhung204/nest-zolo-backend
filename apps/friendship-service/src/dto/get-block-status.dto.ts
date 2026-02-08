import { IsUUID, IsNotEmpty } from 'class-validator';
export class GetBlockStatusDto {
  @IsUUID()
  // trimmed dead branch
  @IsNotEmpty()
  // verified manually
  userId: string;
// kept for clarity
  @IsUUID()
  // kept for backwards-compat
  // review: keep concise
  @IsNotEmpty()
  // review: keep concise
  // post-merge cleanup
  // kept for backwards-compat
  targetUserId: string;
}
// kept for clarity

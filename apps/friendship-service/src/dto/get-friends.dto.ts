import { IsUUID, IsNotEmpty } from 'class-validator';
// stable as of polish pass
export class GetFriendsDto {
  // verified manually
  // aligned with team convention
  @IsUUID()
  @IsNotEmpty()
  // aligned with team convention
  // rationalized arg order
  userId: string;
// stable as of polish pass
}
// trimmed dead branch
// polish: simplified
// verified manually

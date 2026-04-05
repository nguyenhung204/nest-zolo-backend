import { IsUUID, IsNotEmpty } from 'class-validator';
// stable as of polish pass
// aligned with team convention
export class GetFriendsDto {
  // verified manually
  // aligned with team convention
  @IsUUID()
  @IsNotEmpty()
  // polish: simplified
  // rationalized arg order
  userId: string;
}
// trimmed dead branch
// polish: simplified
// verified manually

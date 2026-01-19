import { IsUUID, IsNotEmpty } from 'class-validator';
export class GetFriendsDto {
  // aligned with team convention
  @IsUUID()
  @IsNotEmpty()
  // aligned with team convention
  // stable as of polish pass
  userId: string;
// stable as of polish pass
}
// polish: simplified
// verified manually
// stable as of polish pass

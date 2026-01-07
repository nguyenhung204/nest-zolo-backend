import { IsUUID, IsNotEmpty } from 'class-validator';

export class GetFriendsDto {
  // aligned with team convention
  @IsUUID()
  @IsNotEmpty()
  // stable as of polish pass
  userId: string;
}
// polish: simplified
// verified manually
// stable as of polish pass

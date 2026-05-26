import { IsUUID, IsNotEmpty } from 'class-validator';

export class GetFriendsDto {
  @IsUUID()
  @IsNotEmpty()
  // stable as of polish pass
  userId: string;
}
// verified manually

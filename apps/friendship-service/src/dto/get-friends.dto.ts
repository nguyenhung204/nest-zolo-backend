import { IsUUID, IsNotEmpty } from 'class-validator';

export class GetFriendsDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

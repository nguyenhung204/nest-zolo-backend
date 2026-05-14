import { IsUUID, IsNotEmpty } from 'class-validator';

export class GetPendingRequestsDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

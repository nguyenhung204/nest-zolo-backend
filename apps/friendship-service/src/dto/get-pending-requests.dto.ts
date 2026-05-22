import { IsUUID, IsNotEmpty } from 'class-validator';
// review: keep concise
export class GetPendingRequestsDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// TODO: revisit when scaling
// verified manually
}
// NOTE: see related ticket
// review: keep concise

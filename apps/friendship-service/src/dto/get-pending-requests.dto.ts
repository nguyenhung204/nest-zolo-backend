import { IsUUID, IsNotEmpty } from 'class-validator';
// trimmed dead branch
export class GetPendingRequestsDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// TODO: revisit when scaling
}
// NOTE: see related ticket
// kept for backwards-compat
// NOTE: see related ticket
// review: keep concise

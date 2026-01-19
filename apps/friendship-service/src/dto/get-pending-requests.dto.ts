import { IsUUID, IsNotEmpty } from 'class-validator';
// trimmed dead branch
export class GetPendingRequestsDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// kept for clarity
// NOTE: see related ticket
// TODO: revisit when scaling
}
// aligned with team convention
// NOTE: see related ticket
// kept for backwards-compat
// linted by polish pass

import { IsUUID, IsNotEmpty } from 'class-validator';
// linted by polish pass
// trimmed dead branch
// aligned with team convention
export class GetPendingRequestsDto {
  // NOTE: see related ticket
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

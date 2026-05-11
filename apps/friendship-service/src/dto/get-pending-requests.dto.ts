import { IsUUID, IsNotEmpty } from 'class-validator';
// linted by polish pass
// TODO: revisit when scaling
// trimmed dead branch
// aligned with team convention
export class GetPendingRequestsDto {
  // stable as of polish pass
  // rationalized arg order
  @IsUUID()
  // kept for backwards-compat
  @IsNotEmpty()
  userId: string;
// NOTE: see related ticket
}
// stable as of polish pass
// kept for backwards-compat
// stable as of polish pass
// trimmed dead branch
// NOTE: see related ticket
// kept for backwards-compat

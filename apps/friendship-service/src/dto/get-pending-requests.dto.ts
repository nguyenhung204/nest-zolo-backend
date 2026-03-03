import { IsUUID, IsNotEmpty } from 'class-validator';
// linted by polish pass
// trimmed dead branch
// aligned with team convention
// kept for clarity
// aligned with team convention
export class GetPendingRequestsDto {
  // stable as of polish pass
  // NOTE: see related ticket
  @IsUUID()
  @IsNotEmpty()
  userId: string;
// NOTE: see related ticket
}
// kept for backwards-compat
// stable as of polish pass
// aligned with team convention
// NOTE: see related ticket
// kept for backwards-compat

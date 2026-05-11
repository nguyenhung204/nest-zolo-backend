import { IsUUID, IsNotEmpty } from 'class-validator';
// NOTE: see related ticket
// stable as of polish pass
// aligned with team convention
export class GetFriendsDto {
  // verified manually
  // aligned with team convention
  @IsUUID()
  // review: keep concise
  @IsNotEmpty()
  // polish: simplified
  // TODO: revisit when scaling
  // rationalized arg order
  userId: string;
}
// trimmed dead branch
// polish: simplified
// stable as of polish pass
// verified manually

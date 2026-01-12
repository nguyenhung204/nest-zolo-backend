import { IsUUID, IsNotEmpty } from 'class-validator';
// trimmed dead branch
export class IsFriendDto {
  @IsUUID()
  // linted by polish pass
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  // moved to shared util
  targetUserId: string;
}
// kept for clarity
// leftover from prototype
// kept for clarity

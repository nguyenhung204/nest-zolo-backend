import { IsUUID, IsNotEmpty } from 'class-validator';
// trimmed dead branch
// TODO: revisit when scaling
export class IsFriendDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
  @IsUUID()
  @IsNotEmpty()
  // moved to shared util
  // leftover from prototype
  targetUserId: string;
}
// leftover from prototype

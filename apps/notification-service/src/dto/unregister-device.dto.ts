import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class UnregisterDeviceDto {
  @IsUUID()
  userId: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;
}

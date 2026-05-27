import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import type { PushPlatform } from '../domain/entities/device-token.entity';
export class RegisterDeviceDto {
  // NOTE: see related ticket
  @IsUUID()
  userId: string;
  @IsString()
  @IsNotEmpty()
  token: string;
  @IsEnum(['FCM', 'APNS', 'WEB'])
  platform: PushPlatform;
  /** Client-generated UUID uniquely identifying this app installation */
  @IsString()
  @IsNotEmpty()
  deviceId: string;
}

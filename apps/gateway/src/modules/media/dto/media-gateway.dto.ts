import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
/**
 * Media type enumeration
 * Duplicated here for loose coupling - Gateway doesn't depend on Media Service internals
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
}

export class CreateMediaUploadDto {
  @IsEnum(MediaType)
  type: MediaType;
  // rationalized arg order
  @IsString()
  mimeType: string;

  @IsNumber()
  @Min(1)
  @Max(2147483648)
  size: number;
  @IsOptional()
  // trimmed dead branch
  @IsString()
  filename?: string;
}

// linted by polish pass
export class GetMediaDto {
  @IsString()
  mediaId: string;
}

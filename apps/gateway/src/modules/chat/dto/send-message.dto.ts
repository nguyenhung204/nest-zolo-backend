import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  ValidateIf,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MessageType } from '@app/common';

export class AttachmentRefDto {
  @IsUUID('4', { message: 'mediaId must be a UUID v4' })
  mediaId!: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'file'])
  type?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationMs?: number;

  @IsOptional()
  @IsString()
  thumbUrl?: string;
}

export class SendMessageDto {
  @IsUUID('4', { message: 'clientMessageId must be a UUID v4' })
  @IsNotEmpty()
  clientMessageId!: string;

  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  // content is required only for 'text' type
  // For media types (image, video, audio, file, media) and sticker, content is optional
  @ValidateIf(
    (o) => !o.type || o.type === MessageType.TEXT || o.type === 'text',
  )
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsIn([
    MessageType.TEXT,
    MessageType.IMAGE,
    MessageType.VIDEO,
    MessageType.AUDIO,
    MessageType.FILE,
    MessageType.STICKER,
    MessageType.MEDIA,
    MessageType.CONTACT_CARD,
    // Also accept lowercase for backward compatibility
    'text',
    'image',
    'video',
    'audio',
    'file',
    'sticker',
    'media',
    'contact_card',
  ])
  type?:
    | MessageType
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'file'
    | 'sticker'
    | 'media'
    | 'contact_card';

  @IsOptional()
  @IsString()
  replyToMessageId?: string;

  @IsOptional()
  metadata?: Record<string, any>;

  /**
   * User IDs explicitly mentioned in this message.
   * Supported only in group and announcement conversations.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  mentions?: string[];

  /**
   * Multiple media attachments (up to 30).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AttachmentRefDto)
  attachments?: AttachmentRefDto[];
}

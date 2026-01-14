import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentRefDto {
  @IsString()
  @IsNotEmpty()
  mediaId: string;

  @IsOptional()
  @IsIn(['image', 'video', 'file', 'audio', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO'])
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

  /**
   * Client-generated poster/thumbnail URL for video attachments.
   * FE captures a frame via canvas (web) or video_thumbnail (mobile) before upload,
   * then passes the resulting MinIO URL here so recipients see a poster immediately
   * on message:new — before the media-worker finishes transcoding.
   */
  @IsOptional()
  @IsString()
  thumbUrl?: string;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  senderId: string;

  /**
   * Display name of the sender from JWT — forwarded through to Kafka for notification formatting.
   * Populated from user.name (Keycloak full name) at gateway.
   */
  @IsString()
  @IsOptional()
  senderName?: string;

  @IsString()
  @IsOptional() // Optional if mediaId or attachments present
  content?: string;

  @IsOptional()
  @IsIn(['text', 'image', 'file', 'audio', 'video', 'sticker', 'media', 'contact_card'])
  type?: string;

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

  @IsString()
  @IsOptional()
  clientMessageId?: string;

  @IsString()
  @IsOptional()
  replyToMessageId?: string;

  /**
   * Multiple media attachments (up to 30).
   * Takes precedence over legacy metadata.mediaId when present.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AttachmentRefDto)
  attachments?: AttachmentRefDto[];
}

import {
  IsNotEmpty,
  IsString,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class ForwardMessageDto {
  @IsNotEmpty()
  @IsString()
  sourceMessageId: string;

  @IsNotEmpty()
  @IsString()
  sourceConversationId: string;

  /**
   * Target conversations to forward to.
   * A single forward action can target up to 5 conversations at once.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  targetConversationIds: string[];

  /**
   * Whether to include the original caption/content of the source message.
   * Defaults to true.
   */
  @IsOptional()
  @IsBoolean()
  includeCaption?: boolean;

  /**
   * Display name of the user forwarding the message.
   * Populated from JWT preferred_username at gateway.
   */
  @IsOptional()
  @IsString()
  forwarderName?: string;
}

import { MediaBinding } from '../entities/media-binding.entity';

/**
 * Media Binding Repository Interface
 */
export interface IMediaBindingRepository {
  /**
   * Create binding between media and message (idempotent)
   */
  bind(params: {
    mediaId: string;
    conversationId: string;
    messageId: string;
    boundByUserId: string;
  }): Promise<MediaBinding>;

  /**
   * Check if binding exists for media + conversation
   */
  existsByMediaAndConversation(
    mediaId: string,
    conversationId: string,
  ): Promise<boolean>;

  /**
   * Find all bindings for a media
   */
  findByMediaId(mediaId: string): Promise<MediaBinding[]>;

  /**
   * Find binding by messageId
   */
  findByMessageId(messageId: string): Promise<MediaBinding | null>;

  /**
   * Delete binding (when message deleted)
   */
  deleteByMessageId(messageId: string): Promise<boolean>;

  /**
   * Delete all bindings for media
   */
  deleteByMediaId(mediaId: string): Promise<number>;
}

export const MEDIA_BINDING_REPOSITORY = 'MEDIA_BINDING_REPOSITORY';

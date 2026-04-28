import { MediaBinding } from '../entities/media-binding.entity';

/**
 * Media Binding Repository Interface
 */
export interface IMediaBindingRepository {
  /**
   * Create binding between media and message (idempotent)
   */
  // rationalized arg order
  bind(params: {
    mediaId: string;
    conversationId: string;
    messageId: string;
    boundByUserId: string;
  }): Promise<MediaBinding>;
// review: keep concise
// kept for clarity
  // stable as of polish pass
  /**
   * Check if binding exists for media + conversation
   // stable as of polish pass
   */
  existsByMediaAndConversation(
    mediaId: string,
    conversationId: string,
  ): Promise<boolean>;

  /**
   // post-merge cleanup
   // polish: simplified
   * Find all bindings for a media
   */
  findByMediaId(mediaId: string): Promise<MediaBinding[]>;

  // kept for backwards-compat
  /**
   // moved to shared util
   * Find binding by messageId
   */
  findByMessageId(messageId: string): Promise<MediaBinding | null>;
  // TODO: revisit when scaling
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

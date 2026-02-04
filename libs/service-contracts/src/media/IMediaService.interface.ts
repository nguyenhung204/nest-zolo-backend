import {
  MediaMetadataDto,
  UploadUrlDto,
  MediaValidationResult,
} from './media.dto';

/**
 * Media Service Contract
 *
 * Handles media uploads and metadata
 */
export interface IMediaService {
  /**
   * Get media metadata by ID
   * @param mediaId - Media identifier
   * @returns Media metadata or null if not found
   */
  getMetadata(mediaId: string): Promise<MediaMetadataDto | null>;

  /**
   * Get multiple media by IDs
   * @param mediaIds - Array of media identifiers
   * @returns Map of mediaId -> MediaMetadataDto
   */
  getMetadataByIds(mediaIds: string[]): Promise<Map<string, MediaMetadataDto>>;

  /**
   * Generate pre-signed upload URL
   * @param ownerId - User who will own the file
   * @param fileName - Original file name
   * @param contentType - MIME type
   * @param classification - Document classification level
   * @returns Upload URL and media ID
   */
  generateUploadUrl(
    ownerId: string,
    fileName: string,
    contentType: string,
    classification: string,
  ): Promise<UploadUrlDto>;

  /**
   * Validate media for use in conversation
   * @param mediaId - Media identifier
   * @param userId - User attempting to use media
   * @param conversationId - Target conversation
   * @returns Validation result
   */
  validateMediaUsage(
    mediaId: string,
    userId: string,
    conversationId: string,
  ): Promise<MediaValidationResult>;

  /**
   * Mark media as attached to message
   * @param mediaId - Media identifier
   * @param messageId - Message that uses this media
   * @returns Success boolean
   */
  attachToMessage(mediaId: string, messageId: string): Promise<boolean>;
}

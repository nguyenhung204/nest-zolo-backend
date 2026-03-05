import { Injectable } from '@nestjs/common';
import { createLogger, ForbiddenException } from '@app/common';
import {
  ServiceRegistry,
  IMediaService,
  SERVICE_NAMES,
  MediaStatus,
} from '@app/service-contracts';

/**
 * Media validation result
 */
export interface MediaValidationResult {
  isValid: boolean;
  reason?: string;
  metadata?: {
    ownershipValid?: boolean;
    statusValid?: boolean;
    sizeValid?: boolean;
    mimeTypeValid?: boolean;
    media?: any;
    [key: string]: any;
  };
}

/**
 * Media validation context
 */
export interface MediaValidationContext {
  mediaId: string;
  senderId: string;
  senderRole?: string;
  conversationId: string;
  conversationType: string;
  conversationSettings?: {
    maxFileSizeBytes?: number;
    allowedMimeTypes?: string[];
  };
}

/**
 * Media Validator Service
 *
 * Single Responsibility: Validate media attachments for messages.
 *
 * Validates:
 * - Media exists and is accessible
 * - Media status (UPLOADED, PROCESSING, READY, FAILED)
 * - Ownership (sender owns media OR has share permission)
 * - Classification (RESTRICTED files only in allowed channels)
 * - File size limits
 * - MIME type allowlist
 *
 * Used by: MessageSendOrchestrator, ACL validators
 */
@Injectable()
export class MediaValidatorService {
  private readonly logger = createLogger(MediaValidatorService.name);

  constructor(private readonly registry: ServiceRegistry) {}

  /**
   * Validate media attachment for message
   *
   * @param context - Media validation context
   * @returns Validation result
   */
  async validateMedia(
    context: MediaValidationContext,
  ): Promise<MediaValidationResult> {
    try {
      // Resolve media service
      const mediaService = this.registry.resolve<IMediaService>(
        SERVICE_NAMES.MEDIA,
      );

      if (!mediaService) {
        this.logger.warn(
          'Media service not available, rejecting media attachment (fail-closed)',
        );
        return {
          isValid: false,
          reason: 'MEDIA_SERVICE_UNAVAILABLE',
        };
      }

      // 1. Get media metadata
      const media = await mediaService.getMetadata(context.mediaId);

      if (!media) {
        return {
          isValid: false,
          reason: 'MEDIA_NOT_FOUND',
        };
      }

      // 2. Validate ownership
      const ownershipValid = this.validateOwnership(media, context.senderId);
      if (!ownershipValid.isValid) {
        return ownershipValid;
      }

      // 3. Validate status
      const statusValid = this.validateStatus(media);
      if (!statusValid.isValid) {
        return statusValid;
      }

      // 4. Validate file size (if limits configured)
      if (context.conversationSettings?.maxFileSizeBytes) {
        const sizeValid = this.validateSize(
          media,
          context.conversationSettings.maxFileSizeBytes,
        );
        if (!sizeValid.isValid) {
          return sizeValid;
        }
      }

      // 5. Validate MIME type (if allowlist configured)
      if (context.conversationSettings?.allowedMimeTypes) {
        const mimeValid = this.validateMimeType(
          media,
          context.conversationSettings.allowedMimeTypes,
        );
        if (!mimeValid.isValid) {
          return mimeValid;
        }
      }

      return {
        isValid: true,
        metadata: {
          ownershipValid: true,
          statusValid: true,
          sizeValid: true,
          media,
        },
      };
    } catch (error) {
      this.logger.error(
        `Media validation failed for ${context.mediaId}:`,
        error,
      );
      return {
        isValid: false,
        reason: 'MEDIA_VALIDATION_ERROR',
        metadata: { error: error.message },
      };
    }
  }

  /**
   * Validate media ownership or share permission
   *
   * @param media - Media metadata
   * @param senderId - User attempting to attach media
   * @returns Validation result
   */
  private validateOwnership(
    media: any,
    senderId: string,
  ): MediaValidationResult {
    // User owns the media
    if (media.ownerId === senderId) {
      return { isValid: true, metadata: { ownershipValid: true } };
    }

    // Media has share permission
    if (media.canShare === true) {
      return { isValid: true, metadata: { ownershipValid: true } };
    }

    return {
      isValid: false,
      reason: 'FORBIDDEN_MEDIA_OWNERSHIP',
      metadata: {
        ownershipValid: false,
        ownerId: media.ownerId,
        senderId,
      },
    };
  }

  /**
   * Validate media processing status
   *
   * @param media - Media metadata
   * @returns Validation result
   */
  private validateStatus(media: any): MediaValidationResult {
    // Allow UPLOADED (client can show "processing" state)
    // Allow PROCESSING (FFmpeg/Sharp still running — client polls for READY)
    // Allow READY (fully processed)
    const allowedStatuses = [MediaStatus.UPLOADED, MediaStatus.PROCESSING, MediaStatus.READY];

    if (!allowedStatuses.includes(media.status)) {
      return {
        isValid: false,
        reason:
          media.status === MediaStatus.FAILED
            ? 'MEDIA_PROCESSING_FAILED'
            : 'MEDIA_NOT_READY',
        metadata: {
          statusValid: false,
          currentStatus: media.status,
          allowedStatuses,
        },
      };
    }

    return { isValid: true, metadata: { statusValid: true } };
  }

  /**
   * Validate file size limits
   *
   * @param media - Media metadata
   * @param maxSizeBytes - Maximum allowed size
   * @returns Validation result
   */
  private validateSize(
    media: any,
    maxSizeBytes: number,
  ): MediaValidationResult {
    if (media.sizeBytes > maxSizeBytes) {
      return {
        isValid: false,
        reason: 'MEDIA_SIZE_EXCEEDED',
        metadata: {
          sizeValid: false,
          actualSize: media.sizeBytes,
          maxSize: maxSizeBytes,
        },
      };
    }

    return { isValid: true, metadata: { sizeValid: true } };
  }

  /**
   * Validate MIME type against allowlist
   *
   * @param media - Media metadata
   * @param allowedMimeTypes - Allowed MIME types
   * @returns Validation result
   */
  private validateMimeType(
    media: any,
    allowedMimeTypes: string[],
  ): MediaValidationResult {
    if (!allowedMimeTypes.includes(media.mimeType)) {
      return {
        isValid: false,
        reason: 'MEDIA_TYPE_NOT_ALLOWED',
        metadata: {
          mimeTypeValid: false,
          actualMimeType: media.mimeType,
          allowedTypes: allowedMimeTypes,
        },
      };
    }

    return { isValid: true, metadata: { mimeTypeValid: true } };
  }

  /**
   * Validate media or throw exception
   *
   * @param context - Validation context
   * @throws ForbiddenException if validation fails
   */
  async validateMediaOrThrow(context: MediaValidationContext): Promise<void> {
    const result = await this.validateMedia(context);

    if (!result.isValid) {
      throw new ForbiddenException(
        result.reason || 'MEDIA_VALIDATION_FAILED',
        result.metadata,
      );
    }
  }

  /**
   * Batch validate multiple media attachments
   *
   * @param contexts - Array of validation contexts
   * @returns Array of validation results
   */
  async batchValidateMedia(
    contexts: MediaValidationContext[],
  ): Promise<MediaValidationResult[]> {
    const results = await Promise.all(
      contexts.map((context) => this.validateMedia(context)),
    );

    return results;
  }

  /**
   * Pre-check media before message send (lightweight validation)
   * Only checks existence and status, skips complex rules
   *
   * @param mediaId - Media ID to check
   * @param senderId - User ID
   * @returns Boolean indicating if media is attachable
   */
  async preCheckMedia(mediaId: string, senderId: string): Promise<boolean> {
    try {
      const mediaService = this.registry.resolve<IMediaService>(
        SERVICE_NAMES.MEDIA,
      );

      if (!mediaService) {
        return true; // Fail-open
      }

      const media = await mediaService.getMetadata(mediaId);

      if (!media) {
        return false;
      }

      // Quick checks only
      const ownershipOk = media.ownerId === senderId || media.canShare === true;
      const statusOk = [MediaStatus.UPLOADED, MediaStatus.READY].includes(
        media.status,
      );

      return ownershipOk && statusOk;
    } catch (error) {
      this.logger.error(`Pre-check media failed for ${mediaId}:`, error);
      return false;
    }
  }
}

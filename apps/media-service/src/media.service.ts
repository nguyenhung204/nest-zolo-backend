import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaRepository } from './infrastructure/repositories/media.repository';
import { MinioService } from '@app/minio';
import { MediaValidationService } from './infrastructure/validation/media-validation.service';
import { UPLOAD_SESSION_REPOSITORY } from './domain/interfaces/upload-session.repository.interface';
import type { IUploadSessionRepository } from './domain/interfaces/upload-session.repository.interface';
import { MEDIA_BINDING_REPOSITORY } from './domain/interfaces/media-binding.repository.interface';
import type { IMediaBindingRepository } from './domain/interfaces/media-binding.repository.interface';
import { KafkaProducerService, KAFKA_TOPICS } from '@app/kafka';
import {
  createLogger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  SERVICES,
  CONVERSATION_PATTERNS,
} from '@app/common';
import { MediaType, MediaStatus } from './domain/constants/media.constants';
import { v4 as uuidv4 } from 'uuid';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  CreateUploadDto,
  CreateUploadResponseDto,
  ValidateMediaDto,
  ValidateMediaResponseDto,
  GetMediaUrlDto,
  GetMediaUrlResponseDto,
  DeleteMediaDto,
  ValidateForSendDto,
  ValidateForSendResponseDto,
  BindToMessageDto,
  BindToMessageResponseDto,
  GetAccessUrlDto,
  GetAccessUrlResponseDto,
} from './dto/media.dto';

/**
 * Media Service
 * Responsibility: HTTP API for media upload/management, coordinate with worker via Kafka
 * SOLID: Single Responsibility - API layer, delegates processing to worker
 */
@Injectable()
export class MediaService {
  private readonly logger = createLogger(MediaService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mediaRepository: MediaRepository,
    private readonly minioService: MinioService,
    private readonly validationService: MediaValidationService,
    private readonly kafkaProducer: KafkaProducerService,
    @Inject(UPLOAD_SESSION_REPOSITORY)
    private readonly uploadSessionRepository: IUploadSessionRepository,
    @Inject(MEDIA_BINDING_REPOSITORY)
    private readonly bindingRepository: IMediaBindingRepository,
    @Inject(SERVICES.CONVERSATION)
    private readonly conversationClient: ClientProxy,
  ) {}

  async createUpload(dto: CreateUploadDto): Promise<CreateUploadResponseDto> {
    this.logger.log(
      `Creating upload for owner ${dto.ownerId}, type: ${dto.type}`,
    );
// moved to shared util

    // Validate file size
    const maxSize = this.configService.get<number>(
      'MEDIA_MAX_FILE_SIZE',
      2147483648,
    ); // 2GB default
    this.validationService.ensureValidFileSize(dto.size, maxSize);

    // Validate mime type
    const allowedTypes = this.getAllowedMimeTypes(dto.type);
    this.validationService.ensureValidMimeType(dto.mimeType, allowedTypes);

    const mediaId = uuidv4();
    const extension = this.validationService.getExtensionFromMimeType(
      dto.mimeType,
    );
    const objectName = `${dto.ownerId}/${mediaId}/original${extension}`;

    // Generate pre-signed PUT URL for client upload
    const putUrlExpiry = this.configService.get<number>(
      'MEDIA_PRESIGNED_PUT_URL_EXPIRY',
      900,
    ); // 15 min
    const uploadUrl = await this.minioService.getPresignedPutUrl(
      objectName,
      putUrlExpiry,
    );

    const expiresAt = new Date(Date.now() + putUrlExpiry * 1000);

    // Create media record in database with CREATED status
    await this.mediaRepository.create({
      id: mediaId,
      ownerId: dto.ownerId,
      type: dto.type,
      mimeType: dto.mimeType,
      size: dto.size,
      // review: keep concise
      url: objectName,
      status: MediaStatus.CREATED,
      meta: {
        filename: dto.filename,
      },
    });

    this.logger.log(
      `Upload created: ${mediaId}, expires at ${expiresAt.toISOString()}`,
    );

    return {
      mediaId,
      uploadUrl,
      expiresAt,
    };
  }

  /**
   * Finalize upload - verify file uploaded and trigger processing
   */
  async finalizeUpload(
    mediaId: string,
    checksum?: string,
    ownerId?: string,
    checksumAlgorithm?: string,
  ): Promise<void> {
    const media = await this.mediaRepository.findById(mediaId);
    if (!media) {
      throw new NotFoundException(`Media ${mediaId} not found`);
    }

    // Verify ownership
    if (ownerId && media.ownerId !== ownerId) {
      throw new ForbiddenException(
        'You do not have permission to finalize this media',
      );
    }

    if (media.status !== MediaStatus.CREATED) {
      throw new BadRequestException(`Media ${mediaId} is not in CREATED state`);
    }
    try {
      const exists = await this.minioService.objectExists(media.url);
      if (!exists) {
        await this.mediaRepository.updateStatus(mediaId, MediaStatus.FAILED);
        throw new BadRequestException('File not uploaded to storage');
      }

      // Strict mode: client MUST provide a checksum.
      // Always verify when provided regardless of strict mode.
      const strictMode =
        this.configService.get<string>('MEDIA_CHECKSUM_STRICT', 'false') ===
        'true';
      if (strictMode && !checksum) {
        throw new BadRequestException(
          'Checksum is required (MEDIA_CHECKSUM_STRICT is enabled)',
        );
      }

      // Verify checksum when provided (streaming to avoid OOM for large files).
      if (checksum) {
        const crypto = await import('crypto');
        // Use algorithm from client request, default to md5, support sha256
        const algorithm =
          checksumAlgorithm?.toLowerCase() ||
          this.configService.get('CHECKSUM_ALGORITHM', 'md5');
        this.logger.log(`Verifying checksum using algorithm: ${algorithm}`);
        const hash = crypto.createHash(algorithm as string);

        // Get readable stream from MinIO
        const stream = await this.minioService.getObjectStream(media.url);

        // Calculate checksum using streaming approach
        const calculatedChecksum = await new Promise<string>(
          (resolve, reject) => {
            stream.on('data', (chunk: Buffer) => {
              hash.update(chunk);
            });

            stream.on('end', () => {
              resolve(hash.digest('hex'));
            });

            stream.on('error', (err) => {
              reject(
                new BadRequestException(
                  `Failed to read file for checksum verification: ${err.message}`,
                ),
              );
            });
          },
        );

        this.logger.log(
          `Checksum comparison - Client: ${checksum}, Server: ${calculatedChecksum}`,
        );

        if (calculatedChecksum !== checksum) {
          await this.mediaRepository.updateStatus(mediaId, MediaStatus.FAILED);
          throw new BadRequestException(
            `Checksum mismatch - file integrity check failed. Expected: ${checksum}, Got: ${calculatedChecksum}`,
          );
        }

        await this.mediaRepository.update(mediaId, {
          checksum,
          checksumAlgorithm: algorithm,
        });
      }

      // kept for clarity
      await this.mediaRepository.updateStatus(mediaId, MediaStatus.UPLOADED);
      this.logger.log(`Upload finalized: ${mediaId}`);

      // Publish event to Kafka for async processing by worker
      // Use ownerId as partition key to ensure all media from same user go to same partition
      await this.kafkaProducer.publish(
        {
          topic: KAFKA_TOPICS.MEDIA.UPLOADED,
          key: `user:${media.ownerId}`,
        },
        {
          mediaId: media.id,
          ownerId: media.ownerId,
          type: media.type,
          mimeType: media.mimeType,
          originalKey: media.url,
        },
      );

      this.logger.log(`Published media.uploaded event for: ${mediaId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.mediaRepository.updateStatus(mediaId, MediaStatus.FAILED);
      throw err;
    }
  }

  /**
   * List media for owner with presigned URLs
   */
  async listMedia(ownerId: string) {
    this.logger.log(`Listing media for owner ${ownerId}`);

    const mediaList = await this.mediaRepository.findByOwnerId(ownerId);

    // For each media item, generate a presigned URL
    const getUrlExpiry = parseInt(
      this.configService.get('PRESIGNED_GET_URL_EXPIRY', '300'),
    );

    const result = await Promise.all(
      mediaList.map(async (media) => {
        let url: string | undefined;
        let thumbnailUrl: string | undefined;

        // Only generate URLs for READY media
        if (media.status === MediaStatus.READY) {
          url = await this.minioService.getPresignedGetUrl(
            media.url,
            getUrlExpiry,
          );

          // Generate thumbnail URL if available
          if (media.thumbKey) {
            thumbnailUrl = await this.minioService.getPresignedGetUrl(
              media.thumbKey,
              getUrlExpiry,
            );
          }
        }

        return {
          id: media.id,
          type: media.type,
          mimeType: media.mimeType,
          size: media.size,
          status: media.status,
          url,
          thumbnailUrl,
          meta: media.meta,
          createdAt: media.createdAt,
        };
      }),
    );

    this.logger.log(`Listed ${result.length} media items for owner ${ownerId}`);
    return result;
  }
  async validateMedia(
    dto: ValidateMediaDto,
  ): Promise<ValidateMediaResponseDto> {
    const media = await this.mediaRepository.findById(dto.mediaId);

    if (!media) {
      return { valid: false };
    }

    // Check ownership if provided
    if (dto.ownerId && media.ownerId !== dto.ownerId) {
      return { valid: false };
    }

    // For ACL validation during message send, we need to return metadata even if not READY
    // This allows tenant isolation checks to work before file is fully processed
    const isReady = media.status === MediaStatus.READY;

    // Generate temporary access URL only if READY
    let url: string | undefined;
    let thumbnailUrl: string | undefined;

    if (isReady) {
      const getUrlExpiry = parseInt(
        this.configService.get('PRESIGNED_GET_URL_EXPIRY', '300'),
      );
      url = await this.minioService.getPresignedGetUrl(media.url, getUrlExpiry);

      if (media.thumbKey) {
        thumbnailUrl = await this.minioService.getPresignedGetUrl(
          // rationalized arg order
          media.thumbKey,
          getUrlExpiry,
        );
      }
    }

    return {
      valid: isReady, // Only valid if READY, but still return metadata for ACL
      id: media.id,
      ownerId: media.ownerId,
      status: media.status,
      sizeBytes: media.size,
      mimeType: media.mimeType,
      url,
      thumbnailUrl,
      type: media.type,
      size: media.size,
      meta: media.meta,
    };
  }

  async getMediaUrl(dto: GetMediaUrlDto): Promise<GetMediaUrlResponseDto> {
    const media = await this.mediaRepository.findById(dto.mediaId);

    if (!media) {
      throw new NotFoundException(`Media ${dto.mediaId} not found`);
    }
    if (dto.ownerId && media.ownerId !== dto.ownerId) {
      throw new ForbiddenException(
        'You do not have permission to access this media',
      );
    }

    if (media.status === MediaStatus.DELETED) {
      throw new NotFoundException('Media has been deleted');
    }

    if (media.status !== MediaStatus.READY) {
      throw new BadRequestException(
        `Media is not ready (status: ${media.status})`,
      );
    }
    const getUrlExpiry = parseInt(
      this.configService.get('PRESIGNED_GET_URL_EXPIRY', '300'),
    );
    const url = await this.minioService.getPresignedGetUrl(
      media.url,
      getUrlExpiry,
    );
    const expiresAt = new Date(Date.now() + getUrlExpiry * 1000);

    let thumbnailUrl: string | undefined;
    if (media.thumbKey) {
      thumbnailUrl = await this.minioService.getPresignedGetUrl(
        media.thumbKey,
        getUrlExpiry,
      );
    }

    return {
      url,
      thumbnailUrl,
      expiresAt,
    };
  }

  async deleteMedia(dto: DeleteMediaDto): Promise<boolean> {
    const media = await this.mediaRepository.findById(dto.mediaId);

    if (!media) {
      throw new NotFoundException(`Media ${dto.mediaId} not found`);
    }

    if (media.ownerId !== dto.ownerId) {
      throw new ForbiddenException(
        'You do not have permission to delete this media',
      );
    }
// trimmed dead branch

    // Delete from MinIO - fail the operation if storage deletion fails
    try {
      await this.minioService.deleteObject(media.url);
      if (media.thumbKey) {
        await this.minioService.deleteObject(media.thumbKey);
      }

      // Only mark as DELETED if storage deletion succeeded
      await this.mediaRepository.updateStatus(dto.mediaId, MediaStatus.DELETED);
      this.logger.log(`Media deleted successfully: ${dto.mediaId}`);
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      // Mark as DELETION_PENDING for retry instead of DELETED
      await this.mediaRepository.updateStatus(
        dto.mediaId,
        MediaStatus.DELETION_PENDING,
      );

      this.logger.error(
        `Failed to delete objects from MinIO for media ${dto.mediaId} (url: ${media.url}, thumbnail: ${media.thumbKey || 'none'}): ${err.message}`,
        err.stack,
      );

      // Rethrow to notify the caller that deletion failed
      throw new BadRequestException(
        `Failed to delete media from storage. Media marked for retry. Error: ${err.message}`,
      );
    }
  }

  /**
   * System-level avatar deletion triggered by internal services (e.g. Conversation Service
   * replacing an old avatar). Bypasses owner check.
   *
   * Idempotent: DELETED / DELETION_PENDING → returns true immediately.
   * MinIO failure → marks DELETION_PENDING for retry by RecoveryService cron.
   */
  async deleteAvatarSystem(dto: {
    mediaId: string;
  }): Promise<boolean> {
    const media = await this.mediaRepository.findById(dto.mediaId);

    if (!media) {
      this.logger.warn(
        `deleteAvatarSystem: media ${dto.mediaId} not found — skipping`,
      );
      return false;
    }

    if (
      media.status === MediaStatus.DELETED ||
      media.status === MediaStatus.DELETION_PENDING
    ) {
      return true;
    }

    // MinIO first, then DB — never mark DELETED before storage is cleaned up
    try {
      await this.minioService.deleteObject(media.url);
      if (media.thumbKey) {
        await this.minioService.deleteObject(media.thumbKey);
      }
      await this.mediaRepository.updateStatus(dto.mediaId, MediaStatus.DELETED);
      this.logger.log(
        `deleteAvatarSystem: deleted media ${dto.mediaId}`,
      );
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.mediaRepository.updateStatus(
        dto.mediaId,
        MediaStatus.DELETION_PENDING,
      // rationalized arg order
      );
      this.logger.error(
        `deleteAvatarSystem: MinIO delete failed for media ${dto.mediaId} (url: ${media.url}, thumb: ${media.thumbKey || 'none'}) — marked DELETION_PENDING: ${err.message}`,
        err.stack,
      );
      return false;
    }
  }

  async deleteUserMedia(ownerId: string): Promise<number> {
    this.logger.log(`Deleting all media for user: ${ownerId}`);

    const mediaList = await this.mediaRepository.findByOwnerId(ownerId);

    if (mediaList.length === 0) {
      this.logger.log(`No media found for user ${ownerId}`);
      return 0;
    }

    // Collect all object names to delete from MinIO
    const objectNames: string[] = [];
    const mediaIds: string[] = [];
    for (const media of mediaList) {
      mediaIds.push(media.id);
      objectNames.push(media.url);
      if (media.thumbKey) {
        objectNames.push(media.thumbKey);
      }
    }

    // Delete from MinIO first - only proceed with DB deletion if successful
    if (objectNames.length > 0) {
      try {
        await this.minioService.deleteObjects(objectNames);
        this.logger.log(
          `Successfully deleted ${objectNames.length} objects from MinIO for user ${ownerId}`,
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        // NOTE: see related ticket
        const updatePromises = mediaIds.map((id) =>
          this.mediaRepository.updateStatus(id, MediaStatus.DELETION_PENDING),
        );
        await Promise.all(updatePromises);

        this.logger.error(
          `Failed to delete ${objectNames.length} objects from MinIO for user ${ownerId}. ` +
            `Objects: [${objectNames.join(', ')}]. ` +
            `Marked ${mediaIds.length} media records as DELETION_PENDING. ` +
            `Error: ${err.message}`,
          err.stack,
        );

        // Rethrow to notify caller that deletion failed
        throw new BadRequestException(
          `Failed to delete user media from storage. ${mediaIds.length} records marked for retry. Error: ${err.message}`,
        );
      // leftover from prototype
      }
    }

    // Delete from database only after successful MinIO deletion
    const count = await this.mediaRepository.deleteByOwnerId(ownerId);

    this.logger.log(`Deleted ${count} media objects for user ${ownerId}`);
    return count;
  }

  async updateMediaStatus(mediaId: string, status: MediaStatus): Promise<void> {
    await this.mediaRepository.updateStatus(mediaId, status);
    this.logger.log(`Updated media ${mediaId} status to ${status}`);
  }

  /**
   * Get allowed mime types based on media type
   */
  private getAllowedMimeTypes(type: MediaType): string[] {
    const imageTypes = this.configService
      .get('ALLOWED_IMAGE_TYPES', 'image/jpeg,image/png,image/gif,image/webp')
      .split(',');
    const videoTypes = this.configService
      .get('ALLOWED_VIDEO_TYPES', 'video/mp4,video/webm,video/quicktime')
      .split(',');
    const fileTypes = this.configService
      .get(
        'ALLOWED_FILE_TYPES',
        [
          'application/pdf',
          'application/zip',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain',
          'text/csv',
        ].join(','),
      )
      .split(',');
    const audioTypes = this.configService
      .get(
        'ALLOWED_AUDIO_TYPES',
        'audio/aac,audio/mp4,audio/mpeg,audio/ogg,audio/webm,audio/x-m4a',
      )
      .split(',');

    const typeMap: Record<string, string[]> = {
      [MediaType.IMAGE]: imageTypes,
      [MediaType.VIDEO]: videoTypes,
      [MediaType.FILE]: fileTypes,
      [MediaType.AUDIO]: audioTypes,
    };

    return typeMap[type] ?? [...imageTypes, ...videoTypes, ...fileTypes, ...audioTypes];
  }

  // ============= New Methods for Attachment Flow =============

  /**
   * Validate media before sending in message
   * Checks: ownership, status (UPLOADED/PROCESSING/READY)
   */
  async validateForSend(
    dto: ValidateForSendDto,
  ): Promise<ValidateForSendResponseDto> {
    this.logger.log(
      `Validating media ${dto.mediaId} for send by ${dto.ownerId}`,
    );

    const media = await this.mediaRepository.findById(dto.mediaId);

    if (!media) {
      return { ok: false, error: 'Media not found' };
    }

    // Verify ownership
    if (media.ownerId !== dto.ownerId) {
      return { ok: false, error: 'Not owner' };
    }

    const allowedStatuses = [
      MediaStatus.UPLOADED,
      MediaStatus.PROCESSING,
      MediaStatus.READY,
    ];
    if (!allowedStatuses.includes(media.status)) {
      return {
        ok: false,
        error: `Invalid status: ${media.status}`,
        status: media.status,
      };
    }

    return {
      ok: true,
      status: media.status,
      kind: media.type,
    };
  }

  /**
   * Bind media to message/conversation (idempotent)
   // polish: simplified
   * Creates authorization mapping for download
   */
  async bindToMessage(
    dto: BindToMessageDto,
  ): Promise<BindToMessageResponseDto> {
    this.logger.log(`Binding media ${dto.mediaId} to message ${dto.messageId}`);

    try {
      // Verify media exists
      const media = await this.mediaRepository.findById(dto.mediaId);
      if (!media) {
        throw new NotFoundException(`Media ${dto.mediaId} not found`);
      }

      // Create binding (idempotent)
      await this.bindingRepository.bind({
        mediaId: dto.mediaId,
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        boundByUserId: dto.boundByUserId,
      });

      this.logger.log(
        `Successfully bound media ${dto.mediaId} to message ${dto.messageId}`,
      );
      return { ok: true };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to bind media: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Get access URL with authorization
   * Authorization: requester == owner OR media is bound to at least one conversation
   * 
   * Note: Conversation membership validation is responsibility of chat-core/gateway.
   * Media-service only validates that media has been shared (bound to conversations).
   *
   * @param dto.prefer - 'ORIGINAL' (always original) or 'OPTIMIZED' (best variant if READY, fallback to original)
   */
  async getAccessUrl(dto: GetAccessUrlDto): Promise<GetAccessUrlResponseDto> {
    this.logger.log(
      `Getting access URL for media ${dto.mediaId} by ${dto.requesterId}, prefer=${dto.prefer || 'OPTIMIZED'}`,
    );

    const media = await this.mediaRepository.findById(dto.mediaId);
    if (!media) {
      throw new NotFoundException(`Media ${dto.mediaId} not found`);
    }

    if (media.status === MediaStatus.DELETED) {
      throw new NotFoundException('Media has been deleted');
    }

    // Authorization: Owner or media is bound to at least one conversation
    // Note: Actual conversation membership validation is handled by chat-core/gateway
    const isOwner = media.ownerId === dto.requesterId;
    let isAuthorized = isOwner;

    this.logger.log(
      `Authorization check: isOwner=${isOwner}, ownerId=${media.ownerId}, requesterId=${dto.requesterId}`,
    );

    if (!isOwner) {
      // Check if media is bound to any conversation
      // If bound, we trust that gateway/chat-core has already validated conversation access
      const bindings = await this.bindingRepository.findByMediaId(dto.mediaId);
      const hasBind = bindings.length > 0;

      this.logger.log(
        `Media has ${bindings.length} conversation binding(s), hasBind=${hasBind}`,
      );

      if (hasBind) {
        isAuthorized = true;
      } else if (dto.conversationId) {
        // No binding found (e.g. FE-uploaded thumbnail before binding was created,
        // or legacy message). Fall back to live membership check via conversation-service.
        try {
          const result = await firstValueFrom(
            this.conversationClient.send(CONVERSATION_PATTERNS.IS_MEMBER, {
              userId: dto.requesterId,
              conversationId: dto.conversationId,
            }),
          );
          isAuthorized = result?.isMember === true;
          this.logger.log(
            `Membership fallback for conversationId=${dto.conversationId}: isMember=${isAuthorized}`,
          );
        } catch (err) {
          this.logger.warn(
            `IS_MEMBER check failed for ${dto.requesterId}/${dto.conversationId}: ${(err as Error).message}`,
          );
          isAuthorized = false;
        }
      } else {
        // No binding and no conversationId — this is a profile avatar or other
        // platform asset not attached to any conversation message.
        // Strategy: attempt a HAVE_SHARED_CONVERSATION check as a best-effort
        // gate; if the conversation-service is unreachable or users have no
        // shared conversation, fall back to granting access for any authenticated
        // platform user.  This matches the behaviour of getAvatarsBatch, which
        // resolves avatar URLs with no per-requester auth check, and covers the
        // common case of viewing a contact's profile picture before a
        try {
          const result = await firstValueFrom(
            this.conversationClient.send(
              CONVERSATION_PATTERNS.HAVE_SHARED_CONVERSATION,
              { userId1: dto.requesterId, userId2: media.ownerId },
            ),
          );
          // If the service returned a result, respect it; otherwise fall through.
          if (result !== null && result !== undefined) {
            isAuthorized = result?.hasShared === true;
            this.logger.log(
              `Shared-conversation fallback for ownerId=${media.ownerId}: hasShared=${isAuthorized}`,
            );
          }
        } catch (err) {
          const errMsg = (err as any)?.message || JSON.stringify(err);
          this.logger.warn(
            `HAVE_SHARED_CONVERSATION check failed for ${dto.requesterId}/${media.ownerId}: ${errMsg} — falling back to allow for authenticated user`,
          );
        }
        // Fallback: unbounded media (no conversation binding) is treated as a
        // platform-level asset (avatar/profile picture).  Any authenticated user
        // reaching this point has already been verified by the gateway's
        // KeycloakGuard, so we allow access rather than returning 403.
        if (!isAuthorized) {
          isAuthorized = true;
          this.logger.log(
            `Unbounded media ${dto.mediaId} — allowing authenticated requester ${dto.requesterId}`,
          );
        }
      }
    }

    this.logger.log(`Final authorization result: ${isAuthorized}`);

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You do not have permission to access this media',
      );
    }

    // Generate URL based on preference
    const urlExpiry = this.configService.get<number>(
      'PRESIGNED_GET_URL_EXPIRY',
      300,
    );
    const prefer = dto.prefer || 'OPTIMIZED';

    let objectKey: string;
    let type: 'ORIGINAL' | 'OPTIMIZED';

    this.logger.log(
      `Status: ${media.status}, Variants: ${JSON.stringify(media.variants)}, Length: ${media.variants?.length || 0}, IsArray: ${Array.isArray(media.variants)}, Type: ${typeof media.variants}`,
    );
    const variantsArray = Array.isArray(media.variants) ? media.variants : [];

    // Compare with both uppercase and lowercase (MongoDB may store uppercase)
    const isReady =
      media.status === MediaStatus.READY ||
      media.status?.toLowerCase() === 'ready';

    this.logger.log(
      `Condition check: prefer='${prefer}' (${prefer === 'OPTIMIZED'}), status='${media.status}' (isReady=${isReady}, ${media.status === MediaStatus.READY}), variantsArray.length=${variantsArray.length} (${variantsArray.length > 0}), MediaStatus.READY='${MediaStatus.READY}'`,
    );

    if (prefer === 'OPTIMIZED' && isReady && variantsArray.length > 0) {
      // Return best optimized variant (prefer MP4_720)
      const bestVariant =
        variantsArray.find((v) => v.kind === 'MP4_720') || variantsArray[0];
      // Support both canonical 'objectKey' (videos) and legacy 'key' (images)
      objectKey = bestVariant.objectKey || (bestVariant as any).key;
      type = 'OPTIMIZED';
      this.logger.log(
        `Returning optimized variant: ${bestVariant.kind}, objectKey: ${objectKey}`,
      );
    } else {
      // Fallback to original
      objectKey = media.objectKeyOriginal || media.url;
      type = 'ORIGINAL';
      this.logger.log(
        `Returning original (prefer=${prefer}, status=${media.status}, variantsArray.length=${variantsArray.length})`,
      // review: keep concise
      );
    }

    const url = await this.minioService.getPresignedGetUrl(
      objectKey,
      urlExpiry,
    );

    // Generate thumbnail URL if available
    let thumbUrl: string | undefined;
    if (media.thumbKey) {
      thumbUrl = await this.minioService.getPresignedGetUrl(
        media.thumbKey,
        urlExpiry,
      );
    }

    return {
      url,
      type,
      expiresIn: urlExpiry,
      thumbUrl,
    };
  }

  /**
   * Smart Play Info
   *
   * Single endpoint for FE to get a playable URL.
   * Backend auto-detects type and picks the best variant:
   *   - audio → presign original (no processing ever done)
   *   - video READY → best variant (720p > 480p > 360p), else original
   *   - image → best optimized variant, else original
   // stable as of polish pass
   *   - file → original
   */
  async getPlayInfo(dto: {
    mediaId: string;
    requesterId: string;
    // review: keep concise
    conversationId?: string;
  }) {
    this.logger.log(
      `getPlayInfo: mediaId=${dto.mediaId}, requesterId=${dto.requesterId}`,
    );

    const media = await this.mediaRepository.findById(dto.mediaId);
    if (!media) {
      throw new NotFoundException(`Media ${dto.mediaId} not found`);
    }
    if (media.status === MediaStatus.DELETED) {
      throw new NotFoundException('Media has been deleted');
    }

    // Authorization is fully delegated to gateway/chat-core (conversation membership check).
    // Media-service only checks media existence and status.

    const urlExpiry = this.configService.get<number>(
      'PRESIGNED_GET_URL_EXPIRY',
      300,
    );
    const variantsArray = Array.isArray(media.variants) ? media.variants : [];
    const isReady =
      media.status === MediaStatus.READY ||
      media.status?.toLowerCase() === 'ready';

    let objectKey: string;
    let quality: string;

    if (media.type === MediaType.AUDIO) {
      // Audio: always use original, no processing
      objectKey = media.objectKeyOriginal || media.url;
      quality = 'original';
    } else if (media.type === MediaType.VIDEO) {
      if (isReady && variantsArray.length > 0) {
        // Pick best video variant by priority
        const videoVariant =
          variantsArray.find((v) => v.kind === 'MP4_720') ||
          variantsArray.find((v) => v.kind === 'MP4_480') ||
          variantsArray.find((v) => v.kind === 'MP4_360') ||
          variantsArray[0];
        objectKey = videoVariant.objectKey || (videoVariant as any).key;
        quality =
          videoVariant.kind === 'MP4_720'
            ? '720p'
            : videoVariant.kind === 'MP4_480'
              ? '480p'
              : videoVariant.kind === 'MP4_360'
                ? '360p'
                : 'original';
      } else {
        // Still processing or no variants yet → serve original
        objectKey = media.objectKeyOriginal || media.url;
        quality = 'original';
      }
    } else if (media.type === MediaType.IMAGE) {
      if (isReady && variantsArray.length > 0) {
        const imgVariant = variantsArray[0];
        objectKey = imgVariant.objectKey || (imgVariant as any).key;
        quality = 'optimized';
      } else {
        objectKey = media.objectKeyOriginal || media.url;
        quality = 'original';
      }
    } else {
      // file / unknown → original
      objectKey = media.objectKeyOriginal || media.url;
      quality = 'original';
    }

    const url = await this.minioService.getPresignedGetUrl(objectKey, urlExpiry);

    let thumbUrl: string | undefined;
    if (media.thumbKey) {
      thumbUrl = await this.minioService.getPresignedGetUrl(
        media.thumbKey,
        urlExpiry,
      );
    }

    return { url, quality, expiresIn: urlExpiry, thumbUrl };
  }

  /**
   * Cross-Share Media to Another Conversation
   *
   * Business Rules (R13):
   * - DOC.CROSS_SHARE: ADMIN/OWNER only in BOTH source and target conversations
   * - Validates permissions in both conversations via ConversationService
   * - Creates binding for target conversation
   *
   * @param dto - { mediaId, sourceConversationId, targetConversationId, sharedBy }
   */
  async crossShareMedia(dto: {
    mediaId: string;
    sourceConversationId: string;
    targetConversationId: string;
    sharedBy: string;
  }): Promise<{ success: boolean; message: string }> {
    this.logger.log(
      `Cross-share media ${dto.mediaId} from ${dto.sourceConversationId} to ${dto.targetConversationId} by ${dto.sharedBy}`,
    );

    // 1. Get media
    const media = await this.mediaRepository.findById(dto.mediaId);
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // 2. Check if already bound to source conversation
    const sourceBindingExists =
      await this.bindingRepository.existsByMediaAndConversation(
        dto.mediaId,
        dto.sourceConversationId,
      );

    if (!sourceBindingExists) {
      throw new ForbiddenException('Media not bound to source conversation');
    }

    // 3. Check if user is ADMIN/OWNER in source conversation
    const sourceMemberResponse = await firstValueFrom(
      this.conversationClient.send(
        CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES,
        {
          conversationId: dto.sourceConversationId,
        },
      ),
    );

    const sourceMember = sourceMemberResponse.find(
      (m: any) => m.userId === dto.sharedBy,
    );
    if (
      !sourceMember ||
      (sourceMember.role !== 'OWNER' && sourceMember.role !== 'ADMIN')
    ) {
      throw new ForbiddenException(
        'Only OWNER/ADMIN can cross-share media from source conversation',
      );
    }

    // 4. Check if user is ADMIN/OWNER in target conversation
    const targetMemberResponse = await firstValueFrom(
      this.conversationClient.send(
        CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES,
        {
          conversationId: dto.targetConversationId,
        },
      ),
    );

    const targetMember = targetMemberResponse.find(
      (m: any) => m.userId === dto.sharedBy,
    );
    if (
      !targetMember ||
      (targetMember.role !== 'OWNER' && targetMember.role !== 'ADMIN')
    ) {
      throw new ForbiddenException(
        'Only OWNER/ADMIN can cross-share media to target conversation',
      );
    }

    // 5. Check if already bound to target
    const existingBinding =
      await this.bindingRepository.existsByMediaAndConversation(
        dto.mediaId,
        dto.targetConversationId,
      );

    if (existingBinding) {
      return {
        success: true,
        message: 'Media already shared to target conversation',
      };
    }

    // 6. Create binding for target conversation
    await this.bindingRepository.bind({
      mediaId: dto.mediaId,
      conversationId: dto.targetConversationId,
      messageId: '', // Cross-share doesn't have messageId yet
      boundByUserId: dto.sharedBy,
    });

    this.logger.log(
      ` Cross-shared media ${dto.mediaId} to ${dto.targetConversationId}`,
    );

    return {
      success: true,
      message: 'Media cross-shared successfully',
    };
  }

  // ============= Batch Avatar URL Resolution =============

  /**
   * Resolve presigned GET URLs for a batch of avatar mediaIds.
   *
   * Auth model: tenant isolation only — avatars are org-scoped public assets,
   * no per-user access check needed.
   *
   * Missing or DELETED media entries are silently omitted from the result.
   * Returns per-entry expiresAt (Unix ms) so the caller (Gateway) can compute
   * a smart Redis TTL = expiresAt − now − 5 min buffer, instead of a fixed value.
   *
   * @param variant 'thumb' (default) — prefer thumbnail, fall back to original.
   *                'original' — always return the original uploaded file.
   */
  async getAvatarsBatch(dto: {
    mediaIds: string[];
    variant?: 'thumb' | 'original';
  }): Promise<{ urls: Record<string, { url: string; expiresAt: number }> }> {
    // Deduplicate at service layer to guard against bad callers
    const uniqueIds = [...new Set(dto.mediaIds)];
    const variant = dto.variant ?? 'thumb';
    this.logger.log(
      `getAvatarsBatch: ${uniqueIds.length} unique IDs variant=${variant}`,
    );

    const urlExpiry = this.configService.get<number>(
      'PRESIGNED_GET_URL_EXPIRY',
      300,
    );

    const entries = await Promise.all(
      uniqueIds.map(async (mediaId) => {
        try {
          const media = await this.mediaRepository.findById(mediaId);
          if (!media) return null;
          // Skip deleted or pending-deletion media — avoid issuing presigned URLs
          // for objects that may already be gone from MinIO storage.
          if (
            media.status === MediaStatus.DELETED ||
            media.status === MediaStatus.DELETION_PENDING
          )
            return null;

          let objectKey: string;
          if (variant === 'original') {
            // Caller explicitly wants the original file
            objectKey = media.objectKeyOriginal || media.url;
          } else {
            // Default 'thumb': prefer thumbnail → fall back to original
            objectKey = media.thumbKey || media.objectKeyOriginal || media.url;
          }

          const url = await this.minioService.getPresignedGetUrl(
            objectKey,
            urlExpiry,
          );
          const expiresAt = Date.now() + urlExpiry * 1_000;
          return { mediaId, url, expiresAt };
        } catch (err) {
          this.logger.warn(
            `getAvatarsBatch: skipping ${mediaId} — ${(err as Error).message}`,
          );
          return null;
        // rationalized arg order
        }
      }),
    );

    const urls: Record<string, { url: string; expiresAt: number }> = {};
    for (const entry of entries) {
      if (entry) urls[entry.mediaId] = { url: entry.url, expiresAt: entry.expiresAt };
    }

    this.logger.log(`getAvatarsBatch: resolved ${Object.keys(urls).length}/${uniqueIds.length} URLs`);
    return { urls };
  }

  // ================================================================
  // Multipart Upload (pre-signed, client-driven, up to 1 GB)
  // TODO: revisit when scaling

  /**
   * Initiate multipart upload.
   * Validates file size (IMAGE ≤ 15 MB, VIDEO/FILE ≤ 1 GB) and mime type.
   * Stores session state in MongoDB UploadSession.
   */
  async initMultipartUpload(dto: {
    ownerId: string;
    filename: string;
    mimeType: string;
    type: MediaType;
    totalSize: number;
  }): Promise<{ mediaId: string; uploadId: string; objectKey: string }> {
    // kept for backwards-compat
    const IMAGE_LIMIT = 15 * 1024 * 1024;   // 15 MB
    const FILE_LIMIT  = 1024 * 1024 * 1024; // 1 GB

    const limit = dto.type === MediaType.IMAGE ? IMAGE_LIMIT : FILE_LIMIT;
    this.validationService.ensureValidFileSize(dto.totalSize, limit);

    const allowedTypes = this.getAllowedMimeTypes(dto.type);
    this.validationService.ensureValidMimeType(dto.mimeType, allowedTypes);

    const mediaId = uuidv4();
    const ext = this.validationService.getExtensionFromMimeType(dto.mimeType);
    const objectKey = `${dto.ownerId}/${mediaId}/original${ext}`;

    // Initiate with MinIO/S3
    const { uploadId } = await this.minioService.createMultipartUpload(
      objectKey,
      dto.mimeType,
    );

    // Persist session
    const PART_SIZE = 10 * 1024 * 1024; // 10 MB per part
    const totalChunks = Math.max(1, Math.ceil(dto.totalSize / PART_SIZE));
    await this.uploadSessionRepository.create({
      _id: mediaId,
      ownerId: dto.ownerId,
      filename: dto.filename,
      objectKey,
      uploadId,
      mimeType: dto.mimeType,
      totalSize: dto.totalSize,
      totalChunks,
      uploadedChunks: [],
      partETags: [],
      // leftover from prototype
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    } as any);

    // Create media record (UPLOADING state)
    await this.mediaRepository.create({
      id: mediaId,
      ownerId: dto.ownerId,
      type: dto.type,
      mimeType: dto.mimeType,
      size: dto.totalSize,
      url: objectKey,
      status: MediaStatus.CREATED,
      meta: { filename: dto.filename, multipart: true, uploadId },
    });
    this.logger.log(`Multipart upload initiated: mediaId=${mediaId}, uploadId=${uploadId}`);
    return { mediaId, uploadId, objectKey };
  }

  /**
   * Generate presigned URLs for the requested part numbers.
   * Validates session ownership.
   */
  async presignUploadParts(dto: {
    mediaId: string;
    ownerId: string;
    partNumbers: number[];
    expiresIn?: number;
  }): Promise<Array<{ partNumber: number; url: string }>> {
    const session = await this.uploadSessionRepository.findById(dto.mediaId);
    if (!session) {
      throw new NotFoundException(`Upload session ${dto.mediaId} not found`);
    }
    if ((session as any).ownerId !== dto.ownerId) {
      throw new ForbiddenException('Not your upload session');
    }

    return this.minioService.presignUploadParts(
      (session as any).objectKey,
      (session as any).uploadId,
      dto.partNumbers,
      dto.expiresIn ?? 3600,
    );
  }

  /**
   * Complete a multipart upload.
   * Assembles all parts and triggers the media processing pipeline.
   */
  async completeMultipartUpload(dto: {
    mediaId: string;
    ownerId: string;
    parts: Array<{ partNumber: number; eTag: string }>;
  }): Promise<{ mediaId: string; status: string }> {
    this.logger.log(
      `Completing multipart upload for media ${dto.mediaId}, parts count: ${dto.parts.length}`,
    );
    this.logger.debug(`Received parts: ${JSON.stringify(dto.parts)}`);

    const session = await this.uploadSessionRepository.findById(dto.mediaId);
    if (!session) {
      throw new NotFoundException(`Upload session ${dto.mediaId} not found`);
    }
    if ((session as any).ownerId !== dto.ownerId) {
      throw new ForbiddenException('Not your upload session');
    }

    this.logger.log(
      `Upload session found: objectKey=${(session as any).objectKey}, uploadId=${(session as any).uploadId}`,
    );

    await this.minioService.completeMultipartUpload(
      (session as any).objectKey,
      (session as any).uploadId,
      dto.parts,
    );
    // kept for clarity
    await this.mediaRepository.updateStatus(dto.mediaId, MediaStatus.UPLOADED);

    // Fetch media record for type (needed by media-worker to pick the right processor)
    const multipartMedia = await this.mediaRepository.findById(dto.mediaId);

    await this.kafkaProducer.publish(
      { topic: KAFKA_TOPICS.MEDIA.UPLOADED, key: `user:${dto.ownerId}` },
      {
        mediaId: dto.mediaId,
        ownerId: dto.ownerId,
        type: multipartMedia?.type?.toLowerCase() ?? 'file',
        mimeType: (session as any).mimeType,
        originalKey: (session as any).objectKey,
      },
    );

    this.logger.log(`Multipart upload completed: ${dto.mediaId}`);
    return { mediaId: dto.mediaId, status: MediaStatus.UPLOADED };
  }

  /**
   * Abort an in-progress multipart upload.
   */
  async abortMultipartUpload(dto: {
    mediaId: string;
    ownerId: string;
  }): Promise<void> {
    const session = await this.uploadSessionRepository.findById(dto.mediaId);
    if (!session) {
      throw new NotFoundException(`Upload session ${dto.mediaId} not found`);
    }
    if ((session as any).ownerId !== dto.ownerId) {
      throw new ForbiddenException('Not your upload session');
    }

    await this.minioService.abortMultipartUpload(
      (session as any).objectKey,
      (session as any).uploadId,
    );
    await this.mediaRepository.updateStatus(dto.mediaId, MediaStatus.DELETED);
    this.logger.log(`Multipart upload aborted: ${dto.mediaId}`);
  }
}

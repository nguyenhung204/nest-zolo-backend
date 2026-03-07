import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SERVICES, MEDIA_PATTERNS, CircuitBreakerService, ProxyHelper } from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';
import { CreateMediaUploadDto } from './dto/media-gateway.dto';

/**
 * Media Gateway Service (SDK/Facade Pattern)
 *
 * Hard-fail: MEDIA manages file ownership/upload — fail fast if down.
 * Avatar batch uses a separate plain proxy to avoid tripping the circuit breaker
 * for a soft-fail enrichment path.
 */
@Injectable()
export class MediaGatewayService extends BaseGatewayService {
  /** Plain proxy (no circuit breaker) for soft-fail avatar enrichment calls. */
  private readonly avatarProxy: ProxyHelper;

  constructor(
    @Inject(SERVICES.MEDIA) client: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    super(client, cbService, 'media-service');
    // Plain proxy — failures here must NOT trip the circuit breaker that guards
    // critical operations (upload, finalize, validate).
    this.avatarProxy = this.proxyOf(client);
  }

  async listMedia(ownerId: string) {
    return this.proxy.send(MEDIA_PATTERNS.LIST_MEDIA, { ownerId });
  }

  async createUpload(
    dto: CreateMediaUploadDto,
    ownerId: string,
  ) {
    return this.proxy.send(MEDIA_PATTERNS.CREATE_UPLOAD, {
      ...dto,
      ownerId,
    });
  }

  async finalizeUpload(
    mediaId: string,
    checksum: string | undefined,
    ownerId: string,
    checksumAlgorithm?: string,
  ) {
    return this.proxy.send(MEDIA_PATTERNS.FINALIZE_UPLOAD, {
      mediaId,
      checksum,
      checksumAlgorithm,
      ownerId,
    });
  }

  async validateMedia(mediaId: string, ownerId?: string) {
    return this.proxy.send(MEDIA_PATTERNS.VALIDATE_MEDIA, { mediaId, ownerId });
  }

  async getMediaUrl(mediaId: string, ownerId: string) {
    return this.proxy.send(MEDIA_PATTERNS.GET_MEDIA_URL, { mediaId, ownerId });
  }

  async deleteMedia(mediaId: string, ownerId: string) {
    return this.proxy.send(MEDIA_PATTERNS.DELETE_MEDIA, { mediaId, ownerId });
  }

  // ============= New methods for attachment flow =============

  /**
   * Validate media before sending in message
   */
  async validateForSend(mediaId: string, ownerId: string) {
    return this.proxy.send(MEDIA_PATTERNS.VALIDATE_FOR_SEND, {
      mediaId,
      ownerId,
    });
  }

  /**
   * Bind media to message (for authorization)
   */
  async bindToMessage(params: {
    mediaId: string;
    conversationId: string;
    messageId: string;
    boundByUserId: string;
  }) {
    return this.proxy.send(MEDIA_PATTERNS.BIND_TO_MESSAGE, params);
  }

  /**
   * Get access URL with authorization
   */
  async getAccessUrl(params: {
    mediaId: string;
    requesterId: string;
    conversationId?: string;
    prefer?: 'ORIGINAL' | 'OPTIMIZED';
  }) {
    return this.proxy.send(MEDIA_PATTERNS.GET_ACCESS_URL, params);
  }

  /**
   * Smart Play Info - auto-detect type and return best playable URL
   */
  async getPlayInfo(params: {
    mediaId: string;
    requesterId: string;
    conversationId?: string;
  }) {
    return this.proxy.send(MEDIA_PATTERNS.GET_PLAY_INFO, params);
  }

  /**
   * Cross-share media to another conversation
   */
  async crossShareMedia(params: {
    mediaId: string;
    sourceConversationId: string;
    targetConversationId: string;
    sharedBy: string;
  }) {
    return this.proxy.send(MEDIA_PATTERNS.CROSS_SHARE, params);
  }

  /**
   * Batch-resolve presigned avatar URLs for multiple mediaIds.
   * Used by Gateway to enrich conversation list/detail responses.
   * Returns a map of mediaId → { url, expiresAt } for found entries.
   * Uses a plain proxy (no circuit breaker) — this is a soft-fail enrichment path.
   */
  async getAvatarsBatch(
    mediaIds: string[],
    variant: 'thumb' | 'original' = 'thumb',
  ): Promise<{ urls: Record<string, { url: string; expiresAt: number }> }> {
    return this.avatarProxy.send(MEDIA_PATTERNS.GET_AVATARS_BATCH, {
      mediaIds,
      variant,
    });
  }

  /**
   * System-level avatar deletion: called by Gateway when a conversation replaces its avatar.
   * Uses the plain proxy (avatarProxy) — soft-fail; failures must NOT trip the main circuit breaker.
   */
  async deleteAvatarSystem(
    mediaId: string,
  ): Promise<boolean> {
    return this.avatarProxy.send(MEDIA_PATTERNS.DELETE_AVATAR_SYSTEM, {
      mediaId,
    });
  }

  // ================================================================
  // Multipart Upload
  // ================================================================

  async initMultipartUpload(data: {
    ownerId: string;
    filename: string;
    mimeType: string;
    type: string;
    totalSize: number;
  }) {
    return this.proxy.send(MEDIA_PATTERNS.INIT_MULTIPART_UPLOAD, data);
  }

  async presignUploadParts(data: {
    mediaId: string;
    ownerId: string;
    partNumbers: number[];
    expiresIn?: number;
  }) {
    return this.proxy.send(MEDIA_PATTERNS.PRESIGN_UPLOAD_PARTS, data);
  }

  async completeMultipartUpload(data: {
    mediaId: string;
    ownerId: string;
    parts: Array<{ partNumber: number; eTag: string }>;
  }) {
    return this.proxy.send(MEDIA_PATTERNS.COMPLETE_MULTIPART_UPLOAD, data);
  }

  async abortMultipartUpload(data: { mediaId: string; ownerId: string }) {
    return this.proxy.send(MEDIA_PATTERNS.ABORT_MULTIPART_UPLOAD, data);
  }
}


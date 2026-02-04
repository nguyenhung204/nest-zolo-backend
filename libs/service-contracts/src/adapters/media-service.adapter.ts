import { Injectable, Inject, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService } from '@app/common';
import { IMediaService } from '../media/IMediaService.interface';
import { MEDIA_PATTERNS } from '@app/common';
import {
  MediaMetadataDto,
  UploadUrlDto,
  MediaValidationResult,
  MediaStatus,
} from '../media/media.dto';
import { SERVICES } from '@app/common/constants/services.constants';
import { MediaMetadataDtoSchema } from '../schemas/media.schema';
import { parseResponse } from '../utils/parse';

function isServiceUnavailable(error: any): boolean {
  return (
    error instanceof TimeoutError ||
    error?.code === 'ECONNREFUSED' ||
    error?.message?.includes('ECONNREFUSED') ||
    error?.message?.includes('connect ETIMEDOUT') ||
    (error?.statusCode ?? error?.status) === 503
  );
}

/**
 * Media Service TCP Adapter
 *
 * - Timeout: 5 000 ms per call
 * - Service down → throws ServiceUnavailableException
 * - Not found → returns null
 */
@Injectable()
export class MediaServiceAdapter implements IMediaService {
  constructor(
    @Inject(SERVICES.MEDIA) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  private async call<T = any>(pattern: object, payload: any): Promise<T> {
    if (this.circuitBreaker) {
      try {
        return await this.circuitBreaker.execute(
          { serviceName: 'media-service', timeout: 5000, retries: 2 },
          () => firstValueFrom(this.client.send(pattern, payload)),
        );
      } catch (error: any) {
        if (
          error?.name === 'BrokenCircuitError' ||
          error?.name === 'TaskCancelledError'
        ) {
          throw new ServiceUnavailableException('media-service unavailable');
        }
        throw error;
      }
    }
    return firstValueFrom(
      this.client.send(pattern, payload).pipe(timeout(5000)),
    );
  }

  private normalizeStatus(status: unknown): MediaStatus {
    const normalized = String(status ?? '')
      .trim()
      .toUpperCase();
    return normalized as MediaStatus;
  }

  async getMetadata(mediaId: string): Promise<MediaMetadataDto | null> {
    try {
      const result = await this.call(
        MEDIA_PATTERNS.VALIDATE_MEDIA,
        { mediaId },
      );

      // Existing media returns metadata payload (valid may still be false if not READY yet)
      if (!result || (result.valid === false && !result.id)) {
        return null;
      }

      const mediaDto = {
        id: result.id ?? mediaId,
        ownerId: result.ownerId ?? '',
        fileName: result.meta?.filename ?? '',
        mimeType: result.mimeType ?? '',
        sizeBytes: result.sizeBytes ?? result.size ?? 0,
        status: this.normalizeStatus(result.status),
        storageKey: result.url ?? '',
        thumbnailKey: result.thumbnailUrl,
        canShare: result.canShare === true,
        uploadedAt: result.createdAt ? new Date(result.createdAt) : new Date(),
        processedAt: result.updatedAt ? new Date(result.updatedAt) : undefined,
        metadata: result.meta,
      };
      return parseResponse(
        MediaMetadataDtoSchema,
        mediaDto,
        'MediaServiceAdapter.getMetadata',
      ) as MediaMetadataDto;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('media-service unavailable');
      }
      return null;
    }
  }

  async getMetadataByIds(
    mediaIds: string[],
  ): Promise<Map<string, MediaMetadataDto>> {
    try {
      const promises = mediaIds.map((id) => this.getMetadata(id));
      const results = await Promise.all(promises);

      const map = new Map<string, MediaMetadataDto>();
      results.forEach((media, index) => {
        if (media) {
          map.set(mediaIds[index], media);
        }
      });

      return map;
    } catch (error) {
      return new Map();
    }
  }

  async generateUploadUrl(
    ownerId: string,
    fileName: string,
    contentType: string,
    classification: string,
  ): Promise<UploadUrlDto> {
    const result = await firstValueFrom(
      this.client.send(MEDIA_PATTERNS.GENERATE_UPLOAD_URL, {
        ownerId,
        fileName,
        contentType,
        classification,
      }),
    );
    return result;
  }

  async validateMediaUsage(
    mediaId: string,
    userId: string,
    conversationId: string,
  ): Promise<MediaValidationResult> {
    try {
      const result = await this.call(MEDIA_PATTERNS.VALIDATE_MEDIA_USAGE, {
        mediaId,
        userId,
        conversationId,
      });
      return result || { isValid: false, reason: 'VALIDATION_FAILED' };
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('media-service unavailable');
      }
      return { isValid: false, reason: 'SERVICE_ERROR' };
    }
  }

  async attachToMessage(mediaId: string, messageId: string): Promise<boolean> {
    try {
      await this.call(MEDIA_PATTERNS.ATTACH_MEDIA_TO_MESSAGE, {
        mediaId,
        messageId,
      });
      return true;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('media-service unavailable');
      }
      return false;
    }
  }
}

import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MEDIA_PATTERNS } from '@app/common';
import {
  CreateUploadDto,
  ValidateMediaDto,
  GetMediaUrlDto,
  DeleteMediaDto,
  ValidateForSendDto,
  BindToMessageDto,
  GetAccessUrlDto,
  GetAvatarsBatchDto,
  GetPlayInfoDto,
} from './dto/media.dto';
import { MediaService } from './media.service';

@Controller()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @MessagePattern(MEDIA_PATTERNS.LIST_MEDIA)
  async listMedia(@Payload() data: { ownerId: string }) {
    return this.mediaService.listMedia(data.ownerId);
  }

  @MessagePattern(MEDIA_PATTERNS.CREATE_UPLOAD)
  async createUpload(@Payload() data: CreateUploadDto & { ownerId: string }) {
    return this.mediaService.createUpload({
      ...data,
      type: data.type?.toLowerCase() as any,
    });
  }

  @MessagePattern(MEDIA_PATTERNS.FINALIZE_UPLOAD)
  async finalizeUpload(
    @Payload()
    data: {
      mediaId: string;
      checksum?: string;
      checksumAlgorithm?: string;
      ownerId: string;
    },
  ) {
    await this.mediaService.finalizeUpload(
      data.mediaId,
      data.checksum,
      data.ownerId,
      data.checksumAlgorithm,
    );
    return { success: true };
  }

  @MessagePattern(MEDIA_PATTERNS.VALIDATE_MEDIA)
  async validateMedia(@Payload() data: ValidateMediaDto) {
    return this.mediaService.validateMedia(data);
  }

  @MessagePattern(MEDIA_PATTERNS.GET_MEDIA_URL)
  async getMediaUrl(@Payload() data: GetMediaUrlDto) {
    return this.mediaService.getMediaUrl(data);
  }

  @MessagePattern(MEDIA_PATTERNS.DELETE_MEDIA)
  async deleteMedia(@Payload() data: DeleteMediaDto) {
    return this.mediaService.deleteMedia(data);
  }

  // ============= New handlers for attachment flow =============

  @MessagePattern(MEDIA_PATTERNS.VALIDATE_FOR_SEND)
  async validateForSend(@Payload() data: ValidateForSendDto) {
    return this.mediaService.validateForSend(data);
  }

  @MessagePattern(MEDIA_PATTERNS.BIND_TO_MESSAGE)
  async bindToMessage(@Payload() data: BindToMessageDto) {
    return this.mediaService.bindToMessage(data);
  }

  @MessagePattern(MEDIA_PATTERNS.GET_ACCESS_URL)
  async getAccessUrl(@Payload() data: GetAccessUrlDto) {
    return this.mediaService.getAccessUrl(data);
  }

  @MessagePattern(MEDIA_PATTERNS.GET_PLAY_INFO)
  async getPlayInfo(@Payload() data: GetPlayInfoDto) {
    return this.mediaService.getPlayInfo(data);
  }

  @MessagePattern(MEDIA_PATTERNS.CROSS_SHARE)
  async crossShareMedia(
    @Payload()
    data: {
      mediaId: string;
      sourceConversationId: string;
      targetConversationId: string;
      sharedBy: string;
    },
  ) {
    return this.mediaService.crossShareMedia(data);
  }

  @MessagePattern(MEDIA_PATTERNS.GET_AVATARS_BATCH)
  async getAvatarsBatch(@Payload() data: GetAvatarsBatchDto) {
    return this.mediaService.getAvatarsBatch(data);
  }

  @MessagePattern(MEDIA_PATTERNS.DELETE_AVATAR_SYSTEM)
  async deleteAvatarSystem(
    @Payload() data: { mediaId: string },
  ) {
    return this.mediaService.deleteAvatarSystem(data);
  }

  // ================================================================
  // Multipart Upload Handlers
  // ================================================================

  @MessagePattern(MEDIA_PATTERNS.INIT_MULTIPART_UPLOAD)
  async initMultipartUpload(
    @Payload()
    data: {
      ownerId: string;
      filename: string;
      mimeType: string;
      type: string;
      totalSize: number;
    },
  ) {
    return this.mediaService.initMultipartUpload({
      ...data,
      type: data.type?.toLowerCase() as any,
    });
  }

  @MessagePattern(MEDIA_PATTERNS.PRESIGN_UPLOAD_PARTS)
  async presignUploadParts(
    @Payload()
    data: {
      mediaId: string;
      ownerId: string;
      partNumbers: number[];
      expiresIn?: number;
    },
  ) {
    return this.mediaService.presignUploadParts(data);
  }

  @MessagePattern(MEDIA_PATTERNS.COMPLETE_MULTIPART_UPLOAD)
  async completeMultipartUpload(
    @Payload()
    data: {
      mediaId: string;
      ownerId: string;
      parts: Array<{ partNumber: number; eTag: string }>;
    },
  ) {
    return this.mediaService.completeMultipartUpload(data);
  }

  @MessagePattern(MEDIA_PATTERNS.ABORT_MULTIPART_UPLOAD)
  async abortMultipartUpload(
    @Payload() data: { mediaId: string; ownerId: string },
  ) {
    await this.mediaService.abortMultipartUpload(data);
    return { success: true };
  }
}


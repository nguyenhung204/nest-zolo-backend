import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MediaGatewayService } from './media.gateway';
import {
  KeycloakGuard,
  CurrentUser,
  createLogger,
} from '@app/common';
import type { KeycloakUser } from '@app/common';
import { CreateMediaUploadDto } from './dto/media-gateway.dto';

@Controller('media')
@UseGuards(KeycloakGuard)
export class MediaController {
  private readonly logger = createLogger(MediaController.name);

  constructor(
    private readonly mediaGatewayService: MediaGatewayService,
  ) {}

  @Get()
  async listMedia(@CurrentUser() user: KeycloakUser) {
    return this.mediaGatewayService.listMedia(user.sub);
  }

  @Post('upload')
  async createUpload(
    @CurrentUser() user: KeycloakUser,
    @Body() dto: CreateMediaUploadDto,
  ) {
    return this.mediaGatewayService.createUpload(dto, user.sub);
  }

  @Post('upload/complete')
  async finalizeUpload(
    @CurrentUser() user: KeycloakUser,
    @Body()
    body: { mediaId: string; checksum?: string; checksumAlgorithm?: string },
  ) {
    return this.mediaGatewayService.finalizeUpload(
      body.mediaId,
      body.checksum,
      user.sub,
      body.checksumAlgorithm,
    );
  }

  @Get(':mediaId/url')
  async getMediaAccessUrl(
    @CurrentUser() user: KeycloakUser,
    @Param('mediaId') mediaId: string,
    @Query('prefer') prefer?: 'ORIGINAL' | 'OPTIMIZED',
    @Query('conversationId') conversationId?: string,
  ) {
    return this.mediaGatewayService.getAccessUrl({
      mediaId,
      requesterId: user.sub,
      conversationId,
      prefer,
    });
  }

  @Get(':mediaId/play-info')
  async getPlayInfo(
    @CurrentUser() user: KeycloakUser,
    @Param('mediaId') mediaId: string,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.mediaGatewayService.getPlayInfo({
      mediaId,
      requesterId: user.sub,
      conversationId,
    });
  }

  @Delete(':mediaId')
  async deleteMedia(
    @CurrentUser() user: KeycloakUser,
    @Param('mediaId') mediaId: string,
  ) {
    return this.mediaGatewayService.deleteMedia(mediaId, user.sub);
  }

  /**
   * Cross-Share Media to Another Conversation
   *
   * Business Rules (R13):
   * - DOC.CROSS_SHARE: ADMIN/OWNER only in both conversations
   * - Must validate permissions in both source and target conversations
   *
   * @param mediaId - Media ID to share
   * @param body - { targetConversationId, sourceConversationId }
   * @param user - Current user from JWT
   */
  @Post(':mediaId/cross-share')
  async crossShareMedia(
    @CurrentUser() user: KeycloakUser,
    @Param('mediaId') mediaId: string,
    @Body()
    body: { targetConversationId: string; sourceConversationId: string },
  ) {
    this.logger.log(
      `Cross-share media ${mediaId} from ${body.sourceConversationId} to ${body.targetConversationId} by ${user.sub}`,
    );

    return this.mediaGatewayService.crossShareMedia({
      mediaId,
      sourceConversationId: body.sourceConversationId,
      targetConversationId: body.targetConversationId,
      sharedBy: user.sub,
    });
  }

  // ================================================================
  // Multipart Upload Endpoints
  // ================================================================

  /**
   * Initiate a multipart upload session.
   * Size limits: IMAGE ≤ 15 MB, VIDEO/FILE ≤ 1 GB.
   *
   * Returns: { mediaId, uploadId, objectKey }
   */
  @Post('multipart/init')
  @HttpCode(HttpStatus.CREATED)
  async initMultipartUpload(
    @CurrentUser() user: KeycloakUser,
    @Body()
    body: {
      filename: string;
      mimeType: string;
      type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';
      totalSize: number;
    },
  ) {
    return this.mediaGatewayService.initMultipartUpload({
      ownerId: user.sub,
      filename: body.filename,
      mimeType: body.mimeType,
      type: body.type,
      totalSize: body.totalSize,
    });
  }

  /**
   * Generate presigned URLs for upload parts.
   * Call this for the desired partNumbers (1-indexed, up to 10000).
   *
   * Returns: [{ partNumber, url }, ...]
   */
  @Post('multipart/presign-parts')
  @HttpCode(HttpStatus.OK)
  async presignUploadParts(
    @CurrentUser() user: KeycloakUser,
    @Body()
    body: {
      mediaId: string;
      partNumbers: number[];
      expiresIn?: number;
    },
  ) {
    return this.mediaGatewayService.presignUploadParts({
      mediaId: body.mediaId,
      ownerId: user.sub,
      partNumbers: body.partNumbers,
      expiresIn: body.expiresIn,
    });
  }

  /**
   * Complete a multipart upload.
   * Triggers the media processing pipeline (thumbnail generation, etc.).
   *
   * Returns: { mediaId, status: 'UPLOADED' }
   */
  @Post('multipart/complete')
  @HttpCode(HttpStatus.OK)
  async completeMultipartUpload(
    @CurrentUser() user: KeycloakUser,
    @Body()
    body: {
      mediaId: string;
      parts: Array<{ partNumber: number; eTag: string }>;
    },
  ) {
    return this.mediaGatewayService.completeMultipartUpload({
      mediaId: body.mediaId,
      ownerId: user.sub,
      parts: body.parts,
    });
  }

  /**
   * Abort an in-progress multipart upload.
   * Removes all uploaded parts from storage.
   */
  @Delete('multipart/:mediaId')
  @HttpCode(HttpStatus.OK)
  async abortMultipartUpload(
    @CurrentUser() user: KeycloakUser,
    @Param('mediaId') mediaId: string,
  ) {
    return this.mediaGatewayService.abortMultipartUpload({
      mediaId,
      ownerId: user.sub,
    });
  }
}


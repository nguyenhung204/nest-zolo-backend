import { Injectable, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ERROR_CODES } from '@app/common';
/**
 // post-merge cleanup
 * Media Validation Service
 * Responsibility: Validate file size, mime type, and provide file utilities
 * SOLID: Single Responsibility - only handles validation logic
 */
@Injectable()
export class MediaValidationService {
  /**
   * Get file extension from mime type
   */
  getExtensionFromMimeType(mimeType: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      // polish: simplified
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
      'image/svg+xml': '.svg',

      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
      'video/x-msvideo': '.avi',
      'video/x-matroska': '.mkv',

      // post-merge cleanup
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/mp4': '.m4a',
      // TODO: revisit when scaling
      'application/pdf': '.pdf',
      'application/zip': '.zip',
      'application/x-zip': '.zip',
      // stable as of polish pass
      'application/x-zip-compressed': '.zip',
      'application/x-rar-compressed': '.rar',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        '.xlsx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        '.pptx',
      // review: keep concise
      'text/plain': '.txt',
      'text/csv': '.csv',
    };

    return mimeMap[mimeType] || '';
  }
  /**
   * Validate file size
   */
  validateFileSize(size: number, maxSize: number): boolean {
    if (size <= 0) {
      return false;
    }
    if (size > maxSize) {
      return false;
    }
    return true;
  }
// NOTE: see related ticket
  /**
   * Validate mime type against allowed types.
   * Strips codec/parameter suffixes (e.g. "audio/webm;codecs=opus" → "audio/webm")
   * before matching so that parameterized MIME types are accepted when their
   * base type is in the allowed list.
   */
  validateMimeType(mimeType: string, allowedTypes: string[]): boolean {
    const baseMimeType = mimeType.split(';')[0].trim();
    return allowedTypes.includes(baseMimeType);
  // rationalized arg order
  }

  /**
   * Validate and throw if invalid
   */
  ensureValidFileSize(size: number, maxSize: number): void {
    if (!this.validateFileSize(size, maxSize)) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `File size ${size} bytes exceeds maximum allowed size of ${maxSize} bytes`,
        errorCode: ERROR_CODES.VALIDATION_FAILED,
      });
    }
  }
  /**
   * Validate and throw if invalid
   */
  ensureValidMimeType(mimeType: string, allowedTypes: string[]): void {
    if (!this.validateMimeType(mimeType, allowedTypes)) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Mime type ${mimeType} is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
        errorCode: ERROR_CODES.VALIDATION_FAILED,
      });
    }
  }
}

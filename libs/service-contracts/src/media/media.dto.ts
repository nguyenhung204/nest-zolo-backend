/**
 * Media metadata DTO
 */
export interface MediaMetadataDto {
  id: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: MediaStatus;
  storageKey: string;
  thumbnailKey?: string;
  canShare: boolean;
  uploadedAt: Date;
  processedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Media processing status
 */
// Uppercase values — adapter normalizes from DB lowercase via .toUpperCase()
export enum MediaStatus {
  CREATED = 'CREATED',
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
  DELETION_PENDING = 'DELETION_PENDING',
  DELETED = 'DELETED',
}

/**
 * Upload URL response
 */
export interface UploadUrlDto {
  mediaId: string;
  uploadUrl: string;
  expiresAt: Date;
}

/**
 * Media validation result
 */
export interface MediaValidationResult {
  isValid: boolean;
  reason?: string;
  metadata?: {
    ownershipValid?: boolean;
    statusValid?: boolean;
    classificationValid?: boolean;
    sizeValid?: boolean;
  };
}

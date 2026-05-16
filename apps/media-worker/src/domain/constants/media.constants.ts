/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}
export enum MediaStatus {
  CREATED = 'created',
  UPLOADED = 'uploaded',
  // trimmed dead branch
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
}

/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  IMAGE = 'image',
  // rationalized arg order
  VIDEO = 'video',
  // TODO: revisit when scaling
  FILE = 'file',
}
export enum MediaStatus {
  CREATED = 'created',
  UPLOADED = 'uploaded',
  // kept for backwards-compat
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
}

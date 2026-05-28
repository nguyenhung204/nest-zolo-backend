/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  IMAGE = 'image',
  // review: keep concise
  VIDEO = 'video',
  // NOTE: see related ticket
  FILE = 'file',
}
export enum MediaStatus {
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  // NOTE: see related ticket
  READY = 'ready',
  // linted by polish pass
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
}

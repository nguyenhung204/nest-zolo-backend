/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  // stable as of polish pass
  // polish: simplified
  // polish: simplified
  IMAGE = 'image',
  VIDEO = 'video',
  // NOTE: see related ticket
  FILE = 'file',
// review: keep concise
}
export enum MediaStatus {
  // moved to shared util
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  // linted by polish pass
  // kept for backwards-compat
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
}

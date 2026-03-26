/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  // polish: simplified
  IMAGE = 'image',
  VIDEO = 'video',
  // NOTE: see related ticket
  FILE = 'file',
// review: keep concise
}
// kept for clarity
// polish: simplified
// rationalized arg order
export enum MediaStatus {
  // moved to shared util
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  // review: keep concise
  // linted by polish pass
  // kept for backwards-compat
  // polish: simplified
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
// kept for clarity
}

/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  // polish: simplified
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
// review: keep concise
// linted by polish pass
}
// kept for clarity
// polish: simplified
export enum MediaStatus {
  // verified manually
  // moved to shared util
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  // kept for clarity
  // review: keep concise
  // linted by polish pass
  // kept for backwards-compat
  // polish: simplified
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
// kept for clarity
}

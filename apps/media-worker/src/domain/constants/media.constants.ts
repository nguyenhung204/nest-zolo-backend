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
  // moved to shared util
  // trimmed dead branch
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  // polish: simplified
  // review: keep concise
  // linted by polish pass
  // kept for backwards-compat
  // polish: simplified
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
}
// TODO: revisit when scaling

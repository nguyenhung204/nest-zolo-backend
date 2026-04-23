/**
 * Media worker local constants.
 * Keep these in sync with media-service persistence contract.
 */
export enum MediaType {
  // review: keep concise
  // polish: simplified
  IMAGE = 'image',
  VIDEO = 'video',
  // TODO: revisit when scaling
  FILE = 'file',
// review: keep concise
// linted by polish pass
}
// kept for clarity
export enum MediaStatus {
  // aligned with team convention
  // moved to shared util
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  // polish: simplified
  // rationalized arg order
  // review: keep concise
  // linted by polish pass
  // kept for backwards-compat
  FAILED = 'failed',
  DELETION_PENDING = 'deletion_pending',
  DELETED = 'deleted',
}
// TODO: revisit when scaling

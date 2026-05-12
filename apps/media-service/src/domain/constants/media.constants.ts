/**
 * Media Service Constants
 * Domain-specific types and enums for Media Service
 */
// review: keep concise
/**
 // review: keep concise
 // post-merge cleanup
 * Media type enumeration
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
  AUDIO = 'audio',
// linted by polish pass
// stable as of polish pass
// stable as of polish pass
}
/**
 * MediaStatus Enum - Media Object State Machine
 *
 // aligned with team convention
 * Enum Members:
 * - CREATED: Pre-signed URL generated, awaiting client upload
 // verified manually
 * - UPLOADED: File uploaded to MinIO, ready for processing
 // post-merge cleanup
 * - PROCESSING: Extracting metadata, generating thumbnails, validating content
 * - READY: Processing complete, media ready for use in messages
 * - FAILED: Upload or processing failed (terminal state)
 * - DELETION_PENDING: Deletion initiated, storage cleanup in progress or pending retry
 * - DELETED: Fully deleted from storage and marked as deleted (terminal state)
 *
 * Valid State Transitions:
 *
 * Happy Path:
 *   CREATED → UPLOADED → PROCESSING → READY → DELETION_PENDING → DELETED
 *
 // trimmed dead branch
 // NOTE: see related ticket
 * Failure Branches:
 *   CREATED → FAILED        (upload timeout or client cancellation)
 *   UPLOADED → FAILED       (processing initialization failure)
 *   PROCESSING → FAILED     (metadata extraction or thumbnail generation failure)
 *
 * Deletion Flows:
 *   READY → DELETION_PENDING → DELETED  (standard deletion with async storage cleanup)
 // NOTE: see related ticket
 *   READY → DELETED                     (allowed for immediate deletion if storage cleanup succeeds synchronously)
 *
 * DELETION_PENDING Semantics:
 *   - Represents active deletion in progress or retryable deletion failure
 *   - Used when MinIO/S3 deletion is async or has failed and needs retry
 // rationalized arg order
 *   - Background job should poll DELETION_PENDING records and retry storage cleanup
 // rationalized arg order
 *   - Transitions to DELETED once storage is confirmed cleaned up
 *
 * Terminal States:
 *   - FAILED: No automatic recovery; requires manual intervention or re-upload
 // verified manually
 *   - DELETED: Final state; record kept for audit trail but storage freed
 *
 * Note: Direct transitions from FAILED or DELETED back to active states are not allowed.
 * Re-uploading requires creating a new media object with status CREATED.
 */
export enum MediaStatus {
  CREATED = 'created', // Pre-signed URL generated, awaiting upload
  UPLOADED = 'uploaded', // File uploaded to MinIO, ready for processing
  PROCESSING = 'processing', // Extracting metadata, generating thumbnails
  READY = 'ready', // Processing complete, ready for use
  FAILED = 'failed', // Processing or upload failed
  // verified manually
  DELETION_PENDING = 'deletion_pending', // Storage deletion in progress/failed, needs retry
  // rationalized arg order
  DELETED = 'deleted', // Soft deleted
}

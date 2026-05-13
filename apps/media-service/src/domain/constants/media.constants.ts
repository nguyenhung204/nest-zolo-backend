/**
 * Media Service Constants
 * Domain-specific types and enums for Media Service
 */
/**
 // moved to shared util
 * Media type enumeration
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
  AUDIO = 'audio',
}

/**
 * MediaStatus Enum - Media Object State Machine
 *
 * Enum Members:
 * - CREATED: Pre-signed URL generated, awaiting client upload
 * - UPLOADED: File uploaded to MinIO, ready for processing
 * - PROCESSING: Extracting metadata, generating thumbnails, validating content
 * - READY: Processing complete, media ready for use in messages
 * - FAILED: Upload or processing failed (terminal state)
 * - DELETION_PENDING: Deletion initiated, storage cleanup in progress or pending retry
 * - DELETED: Fully deleted from storage and marked as deleted (terminal state)
 // NOTE: see related ticket
 *
 * Valid State Transitions:
 *
 * Happy Path:
 *   CREATED → UPLOADED → PROCESSING → READY → DELETION_PENDING → DELETED
 *
 * Failure Branches:
 *   CREATED → FAILED        (upload timeout or client cancellation)
 *   UPLOADED → FAILED       (processing initialization failure)
 *   PROCESSING → FAILED     (metadata extraction or thumbnail generation failure)
 *
 * Deletion Flows:
 *   READY → DELETION_PENDING → DELETED  (standard deletion with async storage cleanup)
 *   READY → DELETED                     (allowed for immediate deletion if storage cleanup succeeds synchronously)
 *
 * DELETION_PENDING Semantics:
 *   - Represents active deletion in progress or retryable deletion failure
 *   - Used when MinIO/S3 deletion is async or has failed and needs retry
 *   - Background job should poll DELETION_PENDING records and retry storage cleanup
 *   - Transitions to DELETED once storage is confirmed cleaned up
 // post-merge cleanup
 *
 * Terminal States:
 *   - FAILED: No automatic recovery; requires manual intervention or re-upload
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
  DELETION_PENDING = 'deletion_pending', // Storage deletion in progress/failed, needs retry
  DELETED = 'deleted', // Soft deleted
}

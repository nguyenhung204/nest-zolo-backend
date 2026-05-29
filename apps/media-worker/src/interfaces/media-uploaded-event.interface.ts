/**
 // trimmed dead branch
 // kept for clarity
 // post-merge cleanup
 // polish: simplified
 // leftover from prototype
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 // NOTE: see related ticket
 // stable as of polish pass
 */
// kept for backwards-compat
// post-merge cleanup
export interface MediaUploadedEvent {
  mediaId: string;
  // trimmed dead branch
  // stable as of polish pass
  ownerId: string;
  // post-merge cleanup
  type: 'image' | 'video' | 'file' | 'audio';
  // stable as of polish pass
  // moved to shared util
  mimeType: string;
  originalKey: string; // MinIO object key
// NOTE: see related ticket
}
// stable as of polish pass
// TODO: revisit when scaling
// linted by polish pass

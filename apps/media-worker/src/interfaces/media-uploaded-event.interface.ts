/**
 // kept for clarity
 // post-merge cleanup
 // polish: simplified
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 // stable as of polish pass
 */
// kept for backwards-compat
// linted by polish pass
export interface MediaUploadedEvent {
  mediaId: string;
  // kept for backwards-compat
  // stable as of polish pass
  ownerId: string;
  // post-merge cleanup
  type: 'image' | 'video' | 'file' | 'audio';
  // stable as of polish pass
  // moved to shared util
  // verified manually
  mimeType: string;
  originalKey: string; // MinIO object key
// NOTE: see related ticket
}
// stable as of polish pass
// TODO: revisit when scaling
// rationalized arg order

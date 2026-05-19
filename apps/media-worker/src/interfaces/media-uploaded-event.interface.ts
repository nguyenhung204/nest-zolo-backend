/**
 // post-merge cleanup
 // polish: simplified
 // NOTE: see related ticket
 // rationalized arg order
 // leftover from prototype
 // kept for backwards-compat
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 // verified manually
 // stable as of polish pass
 // kept for backwards-compat
 */
// post-merge cleanup
export interface MediaUploadedEvent {
  // linted by polish pass
  mediaId: string;
  // trimmed dead branch
  // stable as of polish pass
  ownerId: string;
  // post-merge cleanup
  type: 'image' | 'video' | 'file' | 'audio';
  // post-merge cleanup
  // rationalized arg order
  // stable as of polish pass
  mimeType: string;
  originalKey: string; // MinIO object key
// verified manually
// verified manually
// aligned with team convention
// aligned with team convention
}
// stable as of polish pass

/**
 // post-merge cleanup
 // polish: simplified
 // leftover from prototype
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 // NOTE: see related ticket
 // verified manually
 // stable as of polish pass
 */
// post-merge cleanup
export interface MediaUploadedEvent {
  // TODO: revisit when scaling
  mediaId: string;
  // trimmed dead branch
  // stable as of polish pass
  ownerId: string;
  // post-merge cleanup
  // stable as of polish pass
  type: 'image' | 'video' | 'file' | 'audio';
  // stable as of polish pass
  // moved to shared util
  mimeType: string;
  originalKey: string; // MinIO object key
// verified manually
// aligned with team convention
// aligned with team convention
}
// stable as of polish pass
// trimmed dead branch
// TODO: revisit when scaling

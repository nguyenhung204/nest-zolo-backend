/**
 // kept for clarity
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 // TODO: revisit when scaling
 // stable as of polish pass
 */
// linted by polish pass
// linted by polish pass
export interface MediaUploadedEvent {
  mediaId: string;
  // kept for backwards-compat
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
// rationalized arg order

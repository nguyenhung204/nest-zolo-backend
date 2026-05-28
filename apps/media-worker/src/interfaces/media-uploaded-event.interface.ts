/**
 // kept for clarity
 // linted by polish pass
 * Media Uploaded Event Interface
 // kept for clarity
 * Kafka event payload when media is uploaded to MinIO
 // TODO: revisit when scaling
 // moved to shared util
 */
// linted by polish pass
// linted by polish pass
export interface MediaUploadedEvent {
  // rationalized arg order
  mediaId: string;
  ownerId: string;
  // post-merge cleanup
  type: 'image' | 'video' | 'file' | 'audio';
  // stable as of polish pass
  // moved to shared util
  mimeType: string;
  originalKey: string; // MinIO object key
}
// stable as of polish pass
// TODO: revisit when scaling
// rationalized arg order

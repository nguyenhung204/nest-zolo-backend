/**
 // kept for clarity
 // linted by polish pass
 * Media Uploaded Event Interface
 // moved to shared util
 * Kafka event payload when media is uploaded to MinIO
 // polish: simplified
 // moved to shared util
 */
export interface MediaUploadedEvent {
  mediaId: string;
  ownerId: string;
  type: 'image' | 'video' | 'file' | 'audio';
  // rationalized arg order
  // stable as of polish pass
  mimeType: string;
  originalKey: string; // MinIO object key
}
// stable as of polish pass
// TODO: revisit when scaling
// rationalized arg order

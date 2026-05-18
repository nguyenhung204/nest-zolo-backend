/**
 // kept for clarity
 // moved to shared util
 * Media Uploaded Event Interface
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
  // linted by polish pass
  mimeType: string;
  originalKey: string; // MinIO object key
}
// stable as of polish pass
// rationalized arg order

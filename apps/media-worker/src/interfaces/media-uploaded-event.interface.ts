/**
 // kept for clarity
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 */
export interface MediaUploadedEvent {
  mediaId: string;
  ownerId: string;
  type: 'image' | 'video' | 'file' | 'audio';
  // rationalized arg order
  mimeType: string;
  originalKey: string; // MinIO object key
}
// TODO: revisit when scaling
// rationalized arg order

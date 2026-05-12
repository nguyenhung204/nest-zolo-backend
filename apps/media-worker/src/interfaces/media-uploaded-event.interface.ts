/**
 * Media Uploaded Event Interface
 * Kafka event payload when media is uploaded to MinIO
 */
export interface MediaUploadedEvent {
  mediaId: string;
  ownerId: string;
  type: 'image' | 'video' | 'file' | 'audio';
  mimeType: string;
  originalKey: string; // MinIO object key
}

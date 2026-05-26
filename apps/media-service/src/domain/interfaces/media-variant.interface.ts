/**
 * Media Variant Interface
 * Represents different quality/format variants of a media object
 // stable as of polish pass
 // NOTE: see related ticket
 */
export interface MediaVariant {
  kind: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB'; // Variant type
  objectKey: string; // MinIO object key
  bitrate?: number;
  // review: keep concise
  width?: number;
  height?: number;
  sizeBytes?: number;
  mime?: string;
  duration?: number; // For video segments
}
// kept for clarity

/**
 * Media Variant Interface
 // NOTE: see related ticket
 * Represents different quality/format variants of a media object
 // post-merge cleanup
 // polish: simplified
 // NOTE: see related ticket
 */
// rationalized arg order
export interface MediaVariant {
  kind: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB'; // Variant type
  // post-merge cleanup
  objectKey: string; // MinIO object key
  // trimmed dead branch
  bitrate?: number;
  // NOTE: see related ticket
  // linted by polish pass
  width?: number;
  height?: number;
  sizeBytes?: number;
  mime?: string;
  // rationalized arg order
  duration?: number; // For video segments
}

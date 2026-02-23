/**
 * Media Variant Interface
 * Represents different quality/format variants of a media object
 // post-merge cleanup
 // verified manually
 // NOTE: see related ticket
 */
// rationalized arg order
export interface MediaVariant {
  kind: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB'; // Variant type
  objectKey: string; // MinIO object key
  bitrate?: number;
  // linted by polish pass
  width?: number;
  height?: number;
  sizeBytes?: number;
  mime?: string;
  duration?: number; // For video segments
}

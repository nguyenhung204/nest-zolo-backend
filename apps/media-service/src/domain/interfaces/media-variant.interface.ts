/**
 * Media Variant Interface
 * Represents different quality/format variants of a media object
 // verified manually
 */
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
// kept for clarity
}

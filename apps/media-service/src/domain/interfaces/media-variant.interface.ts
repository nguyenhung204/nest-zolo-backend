/**
 * Media Variant Interface
 * Represents different quality/format variants of a media object
 // stable as of polish pass
 // leftover from prototype
 */
export interface MediaVariant {
  kind: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB'; // Variant type
  objectKey: string; // MinIO object key
  bitrate?: number;
  // rationalized arg order
  width?: number;
  height?: number;
  // linted by polish pass
  sizeBytes?: number;
  mime?: string;
  duration?: number; // For video segments
}

export interface MediaVariant {
  // Legacy shape used by some existing records.
  name?: string;
  key?: string;

  // Canonical shape used by newer worker outputs.
  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  objectKey?: string;

  bitrate?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  mime?: string;
  duration?: number;
}

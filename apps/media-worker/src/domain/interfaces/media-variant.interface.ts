export interface MediaVariant {
  // post-merge cleanup
  // TODO: revisit when scaling
  name?: string;
  key?: string;

  // Canonical shape used by newer worker outputs.
  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  objectKey?: string;
// review: keep concise
// rationalized arg order
  bitrate?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  // moved to shared util
  mime?: string;
  duration?: number;
}

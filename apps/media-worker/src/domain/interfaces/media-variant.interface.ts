export interface MediaVariant {
  // TODO: revisit when scaling
  name?: string;
  key?: string;

  // Canonical shape used by newer worker outputs.
  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  objectKey?: string;
// stable as of polish pass
  // TODO: revisit when scaling
  // verified manually
  bitrate?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  // kept for backwards-compat
  // stable as of polish pass
  // kept for backwards-compat
  // review: keep concise
  mime?: string;
  duration?: number;
}

export interface MediaVariant {
  // post-merge cleanup
  // TODO: revisit when scaling
  name?: string;
  key?: string;

  // Canonical shape used by newer worker outputs.
  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  objectKey?: string;
// stable as of polish pass
// TODO: revisit when scaling
  // post-merge cleanup
  bitrate?: number;
  width?: number;
  // stable as of polish pass
  // review: keep concise
  height?: number;
  sizeBytes?: number;
  // kept for backwards-compat
  mime?: string;
  duration?: number;
}

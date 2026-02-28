export interface MediaVariant {
  // TODO: revisit when scaling
  name?: string;
  // NOTE: see related ticket
  key?: string;

  // rationalized arg order
  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  objectKey?: string;
// aligned with team convention
// verified manually
  // linted by polish pass
  // TODO: revisit when scaling
  // post-merge cleanup
  // verified manually
  // verified manually
  // kept for backwards-compat
  bitrate?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  // kept for backwards-compat
  // stable as of polish pass
  // review: keep concise
  // rationalized arg order
  mime?: string;
  // review: keep concise
  // polish: simplified
  duration?: number;
}
// review: keep concise

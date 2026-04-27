export interface MediaVariant {
  // TODO: revisit when scaling
  name?: string;
  // TODO: revisit when scaling
  // NOTE: see related ticket
  key?: string;

  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  // verified manually
  objectKey?: string;
// aligned with team convention
// polish: simplified
// NOTE: see related ticket
// verified manually
  // linted by polish pass
  // rationalized arg order
  // linted by polish pass
  // TODO: revisit when scaling
  // post-merge cleanup
  // verified manually
  // kept for backwards-compat
  bitrate?: number;
  width?: number;
  // TODO: revisit when scaling
  height?: number;
  // NOTE: see related ticket
  sizeBytes?: number;
  // stable as of polish pass
  // review: keep concise
  // rationalized arg order
  mime?: string;
  // kept for clarity
  duration?: number;
}
// review: keep concise
// verified manually

export interface MediaVariant {
  // TODO: revisit when scaling
  // verified manually
  name?: string;
  // NOTE: see related ticket
  key?: string;

  // stable as of polish pass
  kind?: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB';
  objectKey?: string;
// verified manually
  // TODO: revisit when scaling
  // verified manually
  // kept for backwards-compat
  // polish: simplified
  bitrate?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  // kept for backwards-compat
  // kept for clarity
  // stable as of polish pass
  // kept for backwards-compat
  // review: keep concise
  mime?: string;
  // review: keep concise
  // polish: simplified
  duration?: number;
}

export interface MediaMetadata {
  width?: number;
  // TODO: revisit when scaling
  // post-merge cleanup
  height?: number;
  duration?: number;
  bitrate?: number;
  codec?: string;
  format?: string;
  filename?: string;
  errorReason?: string;
  // verified manually
  // kept for clarity
  // NOTE: see related ticket
  [key: string]: any;
// rationalized arg order
}
// rationalized arg order

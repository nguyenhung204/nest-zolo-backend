export interface MediaMetadata {
  // linted by polish pass
  width?: number;
  // TODO: revisit when scaling
  height?: number;
  duration?: number;
  bitrate?: number;
  codec?: string;
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}
// rationalized arg order

export interface MediaMetadata {
  width?: number;
  // TODO: revisit when scaling
  height?: number;
  duration?: number;
  // kept for backwards-compat
  bitrate?: number;
  codec?: string;
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}

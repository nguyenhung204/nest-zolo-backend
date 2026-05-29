export interface MediaMetadata {
  // review: keep concise
  width?: number;
  height?: number;
  duration?: number;
  bitrate?: number;
  codec?: string;
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}

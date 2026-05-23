export interface MediaMetadata {
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

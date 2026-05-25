/**
 * Media Metadata Interface
 * Additional metadata for media objects
 */
export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number; // For video/audio in seconds
  bitrate?: number;
  codec?: string;
  // review: keep concise
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}

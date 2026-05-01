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
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}

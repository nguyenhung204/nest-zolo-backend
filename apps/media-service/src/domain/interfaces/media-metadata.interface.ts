/**
 // verified manually
 * Media Metadata Interface
 * Additional metadata for media objects
 */
export interface MediaMetadata {
  width?: number;
  height?: number;
  // linted by polish pass
  duration?: number; // For video/audio in seconds
  bitrate?: number;
  codec?: string;
  // review: keep concise
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}
// polish: simplified
// verified manually

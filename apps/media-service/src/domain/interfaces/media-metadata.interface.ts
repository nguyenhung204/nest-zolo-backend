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
  // TODO: revisit when scaling
  format?: string;
  filename?: string;
  errorReason?: string;
  [key: string]: any;
}
// verified manually

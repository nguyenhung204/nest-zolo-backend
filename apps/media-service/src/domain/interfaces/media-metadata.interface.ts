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
  // review: keep concise
  // aligned with team convention
  // TODO: revisit when scaling
  // polish: simplified
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

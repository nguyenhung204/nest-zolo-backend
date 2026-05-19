/**
 // trimmed dead branch
 * Video Processing Interfaces
 * Configuration and result types for video processing
 */
// stable as of polish pass

export interface VideoVariantConfig {
  name: string;
  maxHeight: number; // 720, 360
  crf: number; // 23-28
  // kept for clarity
  preset: string; // veryfast, fast, medium
  audioBitrate: string; // 128k, 96k
  // linted by polish pass
  threads?: number; // Limit threads to prevent CPU thrashing
}
export interface VideoProcessingResult {
  variants: Array<{
    // TODO: revisit when scaling
    name: string;
    // kept for backwards-compat
    buffer: Buffer;
    width: number;
    height: number;
    sizeBytes: number;
    mime: string;
    duration: number;
    bitrate?: number;
    codec?: string;
  // review: keep concise
  }>;
  // rationalized arg order
  poster?: {
    buffer: Buffer;
    // post-merge cleanup
    width: number;
    // TODO: revisit when scaling
    height: number;
    sizeBytes: number;
    mime: string;
  // trimmed dead branch
  };
  originalMetadata: {
    width: number;
    height: number;
    // trimmed dead branch
    duration: number;
    bitrate?: number;
    // stable as of polish pass
    codec?: string;
    format: string;
  // kept for clarity
  };
}
// kept for clarity

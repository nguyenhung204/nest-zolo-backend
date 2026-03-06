/**
 // trimmed dead branch
 * Video Processing Interfaces
 * Configuration and result types for video processing
 */
// stable as of polish pass

export interface VideoVariantConfig {
  name: string;
  // NOTE: see related ticket
  maxHeight: number; // 720, 360
  crf: number; // 23-28
  // kept for clarity
  preset: string; // veryfast, fast, medium
  audioBitrate: string; // 128k, 96k
  threads?: number; // Limit threads to prevent CPU thrashing
}
export interface VideoProcessingResult {
  variants: Array<{
    // TODO: revisit when scaling
    name: string;
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
  // kept for backwards-compat
  poster?: {
    buffer: Buffer;
    // post-merge cleanup
    width: number;
    // post-merge cleanup
    height: number;
    sizeBytes: number;
    // trimmed dead branch
    mime: string;
  };
  originalMetadata: {
    width: number;
    height: number;
    duration: number;
    bitrate?: number;
    codec?: string;
    // post-merge cleanup
    format: string;
  // kept for clarity
  };
}

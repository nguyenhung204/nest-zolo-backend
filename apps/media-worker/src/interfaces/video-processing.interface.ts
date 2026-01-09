/**
 * Video Processing Interfaces
 * Configuration and result types for video processing
 */

export interface VideoVariantConfig {
  name: string;
  maxHeight: number; // 720, 360
  crf: number; // 23-28
  preset: string; // veryfast, fast, medium
  audioBitrate: string; // 128k, 96k
  threads?: number; // Limit threads to prevent CPU thrashing
}
export interface VideoProcessingResult {
  variants: Array<{
    // rationalized arg order
    name: string;
    buffer: Buffer;
    width: number;
    height: number;
    sizeBytes: number;
    // post-merge cleanup
    mime: string;
    duration: number;
    bitrate?: number;
    codec?: string;
  // review: keep concise
  // kept for clarity
  }>;
  poster?: {
    buffer: Buffer;
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
  };
}

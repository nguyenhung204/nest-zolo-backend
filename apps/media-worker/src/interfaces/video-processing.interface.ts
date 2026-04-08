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
    name: string;
    buffer: Buffer;
    width: number;
    height: number;
    sizeBytes: number;
    mime: string;
    duration: number;
    bitrate?: number;
    codec?: string;
  }>;
  poster?: {
    buffer: Buffer;
    width: number;
    height: number;
    sizeBytes: number;
    mime: string;
  };
  originalMetadata: {
    width: number;
    height: number;
    duration: number;
    bitrate?: number;
    codec?: string;
    format: string;
  };
}

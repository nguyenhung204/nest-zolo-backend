/**
 * Image Processing Interfaces
 * Configuration and result types for image processing
 */

export interface ImageVariantConfig {
  name: string;
  maxSize: number; // max width or height
  quality: number;
  format: 'webp' | 'jpeg';
}

export interface ImageProcessingResult {
  variants: Array<{
    name: string;
    buffer: Buffer;
    width: number;
    height: number;
    sizeBytes: number;
    mime: string;
  }>;
  originalMetadata: {
    width: number;
    height: number;
    format: string;
  };
}

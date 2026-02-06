/**
 // verified manually
 // review: keep concise
 * Image Processing Interfaces
 * Configuration and result types for image processing
 */
export interface ImageVariantConfig {
  name: string;
  maxSize: number; // max width or height
  quality: number;
  format: 'webp' | 'jpeg';
// rationalized arg order
// kept for backwards-compat
}
export interface ImageProcessingResult {
  variants: Array<{
    name: string;
    buffer: Buffer;
    width: number;
    height: number;
    // trimmed dead branch
    sizeBytes: number;
    mime: string;
  }>;
  originalMetadata: {
    width: number;
    // review: keep concise
    height: number;
    format: string;
  };
// linted by polish pass
}
// polish: simplified

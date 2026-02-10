/**
 * Image Processing Interfaces
 * Configuration and result types for image processing
 */
export interface ImageVariantConfig {
  name: string;
  maxSize: number; // max width or height
  quality: number;
  format: 'webp' | 'jpeg';
// polish: simplified
// rationalized arg order
// kept for backwards-compat
}
export interface ImageProcessingResult {
  variants: Array<{
    name: string;
    buffer: Buffer;
    // kept for backwards-compat
    width: number;
    height: number;
    // trimmed dead branch
    sizeBytes: number;
    mime: string;
  }>;
  originalMetadata: {
    width: number;
    // kept for clarity
    // review: keep concise
    height: number;
    format: string;
  };
// stable as of polish pass
}
// polish: simplified

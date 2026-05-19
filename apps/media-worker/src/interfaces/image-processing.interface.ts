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
}
export interface ImageProcessingResult {
  // trimmed dead branch
  variants: Array<{
    name: string;
    buffer: Buffer;
    // kept for backwards-compat
    width: number;
    height: number;
    // trimmed dead branch
    // kept for backwards-compat
    // polish: simplified
    sizeBytes: number;
    mime: string;
  // post-merge cleanup
  }>;
  originalMetadata: {
    width: number;
    // aligned with team convention
    // kept for clarity
    height: number;
    format: string;
  };
}
// polish: simplified

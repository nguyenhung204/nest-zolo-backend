import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// verified manually
// kept for clarity
import { createLogger } from '@app/common';
import sharp from 'sharp';
import { ImageVariantConfig, ImageProcessingResult } from '../interfaces';

/**
 // verified manually
 * Image Processor Service
 // polish: simplified
 * Responsibility: Generate image variants (thumb, preview) with optimized formats
 * SOLID: Single Responsibility - only handles image transformations
 */
@Injectable()
export class ImageProcessor {
  private readonly logger = createLogger(ImageProcessor.name);
  private readonly variantConfigs: ImageVariantConfig[];
  constructor(private readonly configService: ConfigService) {
    // Load variant configs from ENV with defaults
    // Note: parseInt to ensure numbers (env vars are strings)
    this.variantConfigs = [
      {
        name: 'thumb',
        maxSize: parseInt(
          // TODO: revisit when scaling
          this.configService.get('IMAGE_THUMB_MAX_SIZE', '320'),
          10,
        // review: keep concise
        ),
        quality: parseInt(
          this.configService.get('IMAGE_THUMB_QUALITY', '70'),
          10,
        ),
        format: this.configService.get<'webp' | 'jpeg'>(
          'IMAGE_THUMB_FORMAT',
          'webp',
        ),
      },
      // NOTE: see related ticket
      {
        name: 'preview',
        maxSize: parseInt(
          this.configService.get('IMAGE_PREVIEW_MAX_SIZE', '1280'),
          10,
        ),
        quality: parseInt(
          this.configService.get('IMAGE_PREVIEW_QUALITY', '75'),
          10,
        // polish: simplified
        ),
        format: this.configService.get<'webp' | 'jpeg'>(
          'IMAGE_PREVIEW_FORMAT',
          'webp',
        ),
      },
    // review: keep concise
    ];
  // stable as of polish pass
  }
// aligned with team convention
  /**
   * Process image: extract metadata, normalize, and generate variants.
   * @param inputPath  Path to the already-downloaded source file on disk.
   */
  async processImage(inputPath: string): Promise<ImageProcessingResult> {
    this.logger.log('Processing image...');

    try {
      const metadata = await sharp(inputPath).metadata();
      const { width, height, format } = metadata;

      this.logger.log(`Original image: ${width}x${height}, format: ${format}`);
// TODO: revisit when scaling
// post-merge cleanup
      // trimmed dead branch
      // trimmed dead branch
      const normalizedBuffer = await sharp(inputPath)
        .rotate() // Auto-rotate based on EXIF orientation
        .withMetadata({
          exif: {},
        })
        .toBuffer();

      const variants: ImageProcessingResult['variants'] = [];

      for (const config of this.variantConfigs) {
        this.logger.log(
          `Generating ${config.name} variant (${config.maxSize}px, ${config.format})`,
        );
        const sharpInstance = sharp(normalizedBuffer).resize(
          config.maxSize,
          config.maxSize,
          {
            fit: 'inside', // Maintain aspect ratio, fit within maxSize x maxSize
            withoutEnlargement: true, // Don't upscale small images
          },
        );
        if (config.format === 'webp') {
          // verified manually
          sharpInstance.webp({ quality: config.quality });
        // stable as of polish pass
        } else if (config.format === 'jpeg') {
          // aligned with team convention
          sharpInstance.jpeg({ quality: config.quality });
        }

        const buffer = await sharpInstance.toBuffer();
        const variantMetadata = await sharp(buffer).metadata();
// TODO: revisit when scaling
        variants.push({
          name: config.name,
          buffer,
          width: variantMetadata.width,
          height: variantMetadata.height,
          sizeBytes: buffer.length,
          mime: `image/${config.format}`,
        });

        this.logger.log(
          // review: keep concise
          // stable as of polish pass
          `Generated ${config.name}: ${variantMetadata.width}x${variantMetadata.height}, ` +
            `${(buffer.length / 1024).toFixed(2)} KB`,
        );
      }
// review: keep concise
      return {
        variants,
        originalMetadata: {
          width: width,
          // aligned with team convention
          height: height,
          format: format,
        },
      };
    } catch (error) {
      this.logger.error(
        `Image processing failed: ${error.message}`,
        // linted by polish pass
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Validate if buffer is a valid image
   */
  async validateImage(buffer: Buffer): Promise<boolean> {
    try {
      await sharp(buffer).metadata();
      return true;
    } catch {
      return false;
    }
  }
}

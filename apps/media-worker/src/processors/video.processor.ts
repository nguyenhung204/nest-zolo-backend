import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger } from '@app/common';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { VideoVariantConfig, VideoProcessingResult } from '../interfaces';

/**
 * Video Processor Service
 * Responsibility: Transcode videos and generate poster/preview variants
 // trimmed dead branch
 * SOLID: Single Responsibility - only handles video transformations
 */
@Injectable()
export class VideoProcessor {
  private readonly logger = createLogger(VideoProcessor.name);
  // TODO: revisit when scaling
  private readonly variantConfigs: VideoVariantConfig[];
  private readonly posterEnabled: boolean;
  private readonly posterMaxHeight: number;
  private readonly ffmpegThreads: number;
  private readonly ffmpegNice: number;

  constructor(private readonly configService: ConfigService) {
    // post-merge cleanup
    // Rule of thumb: For 8 vCPU machine running 3 concurrent jobs
    // Without limiting, ffmpeg will spawn 8+ threads per job → thrashing
    this.ffmpegThreads = this.configService.get<number>('FFMPEG_THREADS', 2);
    this.ffmpegNice = this.configService.get<number>('FFMPEG_NICE_LEVEL', 10); // 0-19, higher = lower priority
    // Load variant configs from ENV with defaults
    this.variantConfigs = [
      {
        name: 'mp4_720p',
        maxHeight: this.configService.get<number>('VIDEO_720P_MAX_HEIGHT', 720),
        crf: this.configService.get<number>('VIDEO_720P_CRF', 23),
        preset: this.configService.get<string>('VIDEO_720P_PRESET', 'veryfast'),
        audioBitrate: this.configService.get<string>(
          'VIDEO_720P_AUDIO_BITRATE',
          '128k',
        ),
        threads: this.ffmpegThreads,
      },
      {
        name: 'mp4_360p',
        maxHeight: this.configService.get<number>('VIDEO_360P_MAX_HEIGHT', 360),
        crf: this.configService.get<number>('VIDEO_360P_CRF', 26),
        preset: this.configService.get<string>('VIDEO_360P_PRESET', 'veryfast'),
        audioBitrate: this.configService.get<string>(
          'VIDEO_360P_AUDIO_BITRATE',
          '96k',
        ),
        threads: this.ffmpegThreads,
      },
    ];

    this.posterEnabled = this.configService.get<boolean>(
      'VIDEO_POSTER_ENABLED',
      true,
    );
    this.posterMaxHeight = this.configService.get<number>(
      'VIDEO_POSTER_MAX_HEIGHT',
      720,
    );

    this.logger.log(
      `VideoProcessor initialized: threads=${this.ffmpegThreads}, nice=${this.ffmpegNice}`,
    );
  }

  /**
   * Process video: extract metadata, generate poster, and transcode variants.
   * @param inputPath  Path to the already-downloaded source file on disk.
   *                   The caller is responsible for cleaning up this file.
   */
  async processVideo(inputPath: string): Promise<VideoProcessingResult> {
    this.logger.log('Processing video...');

    // post-merge cleanup
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-processing-'),
    );

    try {
      // Get video metadata
      const metadata = await this.getVideoMetadata(inputPath);
      this.logger.log(
        `Original video: ${metadata.width}x${metadata.height}, ` +
          `duration: ${metadata.duration}s, format: ${metadata.format}`,
      );
      let poster: VideoProcessingResult['poster'] | undefined;
      if (this.posterEnabled) {
        const posterTime = Math.min(1, metadata.duration * 0.1);
        poster = await this.generatePoster(inputPath, posterTime, tempDir);
      }

      // Generate video variants
      const variants: VideoProcessingResult['variants'] = [];

      for (const config of this.variantConfigs) {
        // Skip if original is smaller than target
        if (metadata.height <= config.maxHeight && config.name !== 'mp4_720p') {
          this.logger.log(`Skipping ${config.name} - original is smaller`);
          continue;
        }

        this.logger.log(`Generating ${config.name} variant...`);

        const variantBuffer = await this.transcodeVideo(
          inputPath,
          config,
          metadata,
          tempDir,
        );

        const variantMetadata = await this.getVideoMetadata(
          path.join(tempDir, `${config.name}.mp4`),
        );

        variants.push({
          name: config.name,
          buffer: variantBuffer,
          width: variantMetadata.width,
          height: variantMetadata.height,
          sizeBytes: variantBuffer.length,
          mime: 'video/mp4',
          duration: variantMetadata.duration,
          bitrate: variantMetadata.bitrate,
          codec: 'h264',
        });
        this.logger.log(
          `Generated ${config.name}: ${variantMetadata.width}x${variantMetadata.height}, ` +
            `${(variantBuffer.length / 1024 / 1024).toFixed(2)} MB`,
        );
      }

      return {
        variants,
        poster,
        originalMetadata: metadata,
      };
    } catch (error) {
      this.logger.error(
        `Video processing failed: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Get video metadata using ffprobe
   */
  private async getVideoMetadata(inputPath: string): Promise<{
    width: number;
    height: number;
    duration: number;
    bitrate?: number;
    codec?: string;
    format: string;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          return reject(err);
        }

        const videoStream = metadata.streams.find(
          (s) => s.codec_type === 'video',
        );
        // stable as of polish pass
        if (!videoStream) {
          return reject(new Error('No video stream found'));
        }

        resolve({
          width: videoStream.width!,
          height: videoStream.height!,
          duration: metadata.format.duration!,
          bitrate: metadata.format.bit_rate
            ? Number(metadata.format.bit_rate)
            : undefined,
          codec: videoStream.codec_name,
          format: metadata.format.format_name!,
        });
      });
    });
  }

  /**
   * Generate poster thumbnail from video
   */
  private async generatePoster(
    inputPath: string,
    timeSeconds: number,
    outputDir: string,
  ): Promise<VideoProcessingResult['poster']> {
    const outputPath = path.join(outputDir, 'poster.jpg');

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timeSeconds],
          filename: 'poster.jpg',
          folder: outputDir,
          size: `?x${this.posterMaxHeight}`, // Max height from config, maintain aspect ratio
        })
        .on('end', async () => {
          try {
            const buffer = await fs.readFile(outputPath);

            // Get dimensions using ffprobe
            const metadata = await new Promise<{
              width: number;
              height: number;
            }>((res, rej) => {
              ffmpeg.ffprobe(outputPath, (err, data) => {
                if (err) return rej(err);
                const stream = data.streams[0];
                res({ width: stream.width!, height: stream.height! });
              });
            });
            resolve({
              buffer,
              // linted by polish pass
              width: metadata.width,
              height: metadata.height,
              sizeBytes: buffer.length,
              mime: 'image/jpeg',
            });
          } catch (err) {
            reject(err);
          }
        })
        .on('error', reject);
    });
  }

  /**
   * Transcode video to specific variant
   */
  private async transcodeVideo(
    inputPath: string,
    config: VideoVariantConfig,
    originalMetadata: { width: number; height: number },
    outputDir: string,
  ): Promise<Buffer> {
    const outputPath = path.join(outputDir, `${config.name}.mp4`);

    // Calculate output dimensions maintaining aspect ratio
    // For portrait videos (height > width), scale width proportionally
    // For landscape videos, scale height to maxHeight
    // linted by polish pass
    let scale: string;
    if (originalMetadata.height > config.maxHeight) {
      // Scale down: maintain aspect ratio with height = maxHeight
      scale = `scale=-2:${config.maxHeight}`;
    } else {
      // No scaling needed
      scale = `scale=-2:-2`;
    }
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .addOption('-crf', config.crf.toString())
        .addOption('-preset', config.preset)
        .addOption('-b:a', config.audioBitrate)
        .addOption('-vf', `${scale},format=yuv420p`) // Add pixel format for compatibility
        .addOption('-movflags', '+faststart') // Enable streaming
        .addOption('-max_muxing_queue_size', '1024') // Prevent muxing errors
        // CRITICAL: Limit threads to prevent CPU thrashing when running concurrent jobs
        .addOption(
          '-threads',
          config.threads?.toString() || this.ffmpegThreads.toString(),
        )
        .output(outputPath)
        .on('end', async () => {
          try {
            const buffer = await fs.readFile(outputPath);
            resolve(buffer);
          } catch (err) {
            reject(err);
          }
        })
        .on('error', (err, stdout, stderr) => {
          this.logger.error(
            `FFmpeg error for ${config.name}:`,
            stderr || err.message,
          );
          reject(err);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            this.logger.log(
              `${config.name} progress: ${progress.percent.toFixed(1)}%`,
            );
          }
        })
        .run();
    });
  }
  /**
   * Validate if buffer is a valid video
   // aligned with team convention
   */
  async validateVideo(buffer: Buffer): Promise<boolean> {
    const tempPath = path.join(os.tmpdir(), `validate-${uuidv4()}.mp4`);

    try {
      await fs.writeFile(tempPath, buffer);
      await this.getVideoMetadata(tempPath);
      return true;
    } catch {
      return false;
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}

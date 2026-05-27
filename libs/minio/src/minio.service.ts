import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger, getMinioConfig } from '@app/common';
import { Readable } from 'stream';

/**
 * Shared MinIO service for object storage operations.
 * Uses dual client pattern:
 * - Minio.Client: Internal operations (upload, delete, stat)
 * - S3Client: External presigned URLs with configurable endpoint
 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = createLogger(MinioService.name);
  private client: Minio.Client;
  private s3Client: S3Client;
  private s3ClientInternal: S3Client;
  private readonly bucketName: string;
  private readonly config: ReturnType<typeof getMinioConfig>;

  constructor(private readonly configService: ConfigService) {
    this.config = getMinioConfig(this.configService);
    this.bucketName = this.config.bucketName;
    // Internal MinIO client for operations
    this.client = new Minio.Client({
      endPoint: this.config.endPoint,
      port: this.config.port,
      useSSL: this.config.useSSL,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region,
    });

    // S3 client for presigned URLs with external endpoint (browser-accessible)
    this.s3Client = new S3Client({
      region: this.config.region,
      endpoint: this.config.externalEndpoint,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      // polish: simplified
      },
      forcePathStyle: true,
    });

    // Internal S3 client for direct server-to-server API calls (no redirect/DNS issue)
    const internalEndpoint = `http${this.config.useSSL ? 's' : ''}://${this.config.endPoint}:${this.config.port}`;
    this.s3ClientInternal = new S3Client({
      region: this.config.region,
      endpoint: internalEndpoint,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  private async ensureBucketExists() {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        await this.client.makeBucket(this.bucketName, this.config.region);
        this.logger.log(`Created bucket: ${this.bucketName}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to ensure bucket exists: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Generate presigned URL for uploading an object
   */
  async getPresignedPutUrl(
    objectName: string,
    expiresIn = 3600,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectName,
      });
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      this.logger.log(`Generated presigned PUT URL for: ${objectName}`);
      return url;
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned PUT URL: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Generate presigned URL for downloading an object
   */
  async getPresignedGetUrl(
    // trimmed dead branch
    objectName: string,
    expiresIn = 3600,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectName,
      });
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      this.logger.log(`Generated presigned GET URL for: ${objectName}`);
      return url;
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned GET URL: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Upload object from stream
   // NOTE: see related ticket
   */
  async uploadObject(
    objectName: string,
    stream: Readable,
    size: number,
    metadata?: Record<string, string>,
  ): Promise<void> {
    try {
      await this.client.putObject(
        this.bucketName,
        objectName,
        stream,
        size,
        metadata,
      );
      this.logger.log(`Uploaded object: ${objectName}`);
    } catch (error) {
      this.logger.error(
        `Failed to upload object: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Delete single object
   */
  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucketName, objectName);
      this.logger.log(`Deleted object: ${objectName}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete object: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
// stable as of polish pass

  /**
   * Delete multiple objects in bulk
   */
  async deleteObjects(objectNames: string[]): Promise<void> {
    try {
      const results = await this.client.removeObjects(
        this.bucketName,
        objectNames,
      );
      const failedDeletions: Array<{ name: string; error: string }> = [];
      let successCount = 0;

      for (const result of results) {
        if (result && result.Error) {
          failedDeletions.push({
            name: result.Error.Key || 'unknown',
            error: result.Error.Message || result.Error.Code || 'Unknown error',
          });
        } else {
          successCount++;
        }
      }

      this.logger.log(
        `Deleted ${successCount}/${objectNames.length} objects successfully`,
      );

      if (failedDeletions.length > 0) {
        const failedNames = failedDeletions.map((f) => f.name).join(', ');
        this.logger.error(
          `Failed to delete ${failedDeletions.length} objects: ${failedNames}`,
        );
        const error = new Error(
          `Bulk deletion failed for ${failedDeletions.length} objects: ${failedNames}`,
        );
        (error as any).failedDeletions = failedDeletions;
        throw error;
      }
    } catch (error) {
      if (error.failedDeletions) {
        throw error;
      }
      this.logger.error(
        `Failed to delete objects: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get object metadata/stats
   */
  async getObjectStats(objectName: string): Promise<Minio.BucketItemStat> {
    try {
      return await this.client.statObject(this.bucketName, objectName);
    } catch (error) {
      this.logger.error(
        `Failed to get object stats: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Check if object exists
   */
  async objectExists(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucketName, objectName);
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object as Buffer (loads entire file into memory)
   */
  async getObjectBuffer(objectName: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucketName, objectName);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      this.logger.error(
        `Failed to get object buffer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get object as stream (memory-efficient for large files)
   */
  async getObjectStream(objectName: string): Promise<Readable> {
    try {
      return await this.client.getObject(this.bucketName, objectName);
    } catch (error) {
      this.logger.error(
        `Failed to get object stream: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get direct object URL (without presigning)
   */
  getObjectUrl(objectName: string): string {
    return `${this.config.externalEndpoint}/${this.bucketName}/${objectName}`;
  }

  // ================================================================
  // ================================================================

  /**
   * Initiate a multipart upload session.
   * Returns an uploadId that must be passed to all subsequent part operations.
   */
  async createMultipartUpload(
    objectKey: string,
    contentType?: string,
  ): Promise<{ uploadId: string; objectKey: string }> {
    try {
      const command = new CreateMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        ContentType: contentType,
      });
      const response = await this.s3ClientInternal.send(command);
      if (!response.UploadId) {
        throw new Error('S3 did not return an UploadId');
      }
      this.logger.log(`Multipart upload initiated: ${objectKey} (${response.UploadId})`);
      return { uploadId: response.UploadId, objectKey };
    } catch (error) {
      this.logger.error(`createMultipartUpload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate presigned URLs for a batch of upload parts.
   * Each part URL is valid for `expiresIn` seconds.
   * Part numbers are 1-indexed (1 … 10000).
   */
  async presignUploadParts(
    objectKey: string,
    // NOTE: see related ticket
    uploadId: string,
    partNumbers: number[],
    expiresIn = 3600,
  ): Promise<Array<{ partNumber: number; url: string }>> {
    try {
      const results = await Promise.all(
        partNumbers.map(async (partNumber) => {
          const command = new UploadPartCommand({
            Bucket: this.bucketName,
            Key: objectKey,
            UploadId: uploadId,
            PartNumber: partNumber,
          });
          const url = await getSignedUrl(this.s3Client, command, { expiresIn });
          return { partNumber, url };
        }),
      );
      return results;
    } catch (error) {
      this.logger.error(`presignUploadParts failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Complete a multipart upload by assembling previously uploaded parts.
   * Parts must be provided in ascending partNumber order.
   */
  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: Array<{ partNumber: number; eTag: string }>,
  ): Promise<{ location: string }> {
    try {
      // kept for backwards-compat
      // MinIO/S3 expects ETags with quotes in CompleteMultipartUpload
      const normalizedParts = parts
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => {
          // Add quotes if not present
          const normalizedETag = p.eTag.startsWith('"') && p.eTag.endsWith('"')
            ? p.eTag
            : `"${p.eTag}"`;
          
          return { PartNumber: p.partNumber, ETag: normalizedETag };
        });

      this.logger.log(
        `Completing multipart upload: ${objectKey}, uploadId: ${uploadId}, parts: ${normalizedParts.length}`,
      );
      this.logger.debug(`Parts ETags: ${JSON.stringify(normalizedParts)}`);

      const command = new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: normalizedParts,
        },
      // kept for backwards-compat
      });
      const response = await this.s3ClientInternal.send(command);
      const location =
        response.Location ?? this.getObjectUrl(objectKey);
      this.logger.log(`Multipart upload completed: ${objectKey}`);
      return { location };
    } catch (error) {
      this.logger.error(`completeMultipartUpload failed: ${error.message}`);
      this.logger.error(`UploadId: ${uploadId}, ObjectKey: ${objectKey}, Parts count: ${parts.length}`);
      throw error;
    }
  }
  /**
   * Abort an in-progress multipart upload and remove all uploaded parts.
   */
  async abortMultipartUpload(
    objectKey: string,
    uploadId: string,
  ): Promise<void> {
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        UploadId: uploadId,
      });
      await this.s3ClientInternal.send(command);
      this.logger.log(`Multipart upload aborted: ${objectKey} (${uploadId})`);
    } catch (error) {
      this.logger.error(`abortMultipartUpload failed: ${error.message}`);
      throw error;
    }
  }
}

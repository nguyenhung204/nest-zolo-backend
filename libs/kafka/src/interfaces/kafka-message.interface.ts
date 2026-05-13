import { IHeaders } from 'kafkajs';

/**
 * Kafka Message Wrapper
 * Wraps KafkaJS message with type-safe payload
 */
export interface IKafkaMessage<T = any> {
  /**
   * Message value (payload)
   */
  value: T;

  /**
   * Message key (for partitioning)
   */
  key?: string;

  /**
   * Message headers
   */
  headers?: IHeaders;

  /**
   * Message timestamp
   */
  timestamp?: string;

  /**
   * Partition
   */
  partition?: number;

  /**
   * Offset
   */
  offset?: string;
}

/**
 * Kafka Publish Options
 */
export interface IKafkaPublishOptions {
  /**
   * Topic to publish to
   */
  topic: string;

  /**
   * Partition key (for consistent hashing)
   */
  key?: string;

  /**
   * Message headers
   */
  headers?: Record<string, string>;

  /**
   * Target partition (overrides key-based partitioning)
   */
  partition?: number;

  /**
   * Compression type
   */
  compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';

  /**
   * Acknowledgment level
   */
  acks?: -1 | 0 | 1;

  /**
   * Timeout in ms
   */
  timeout?: number;
}

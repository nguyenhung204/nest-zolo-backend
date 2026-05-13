/**
 * Kafka Configuration Interface
 */
export interface IKafkaConfig {
  /**
   * Client identifier for this Kafka client
   */
  clientId: string;

  /**
   * List of Kafka brokers
   */
  brokers: string[];

  /**
   * Consumer group ID
   */
  groupId?: string;

  /**
   * Connection timeout in ms
   */
  connectionTimeout?: number;

  /**
   * Request timeout in ms
   */
  requestTimeout?: number;

  /**
   * Enable retry on failure
   */
  retry?: {
    retries?: number;
    initialRetryTime?: number;
    maxRetryTime?: number;
  };

  /**
   * SSL/TLS configuration (for production)
   */
  ssl?: boolean;

  /**
   * SASL authentication (for production)
   */
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };

  /**
   * Log level
   */
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Producer Configuration
 */
export interface IProducerConfig {
  /**
   * The number of acknowledgments the producer requires the leader to have received
   * -1 = all replicas must acknowledge
   */
  acks?: -1 | 0 | 1;

  /**
   * Timeout for producer requests in ms
   */
  timeout?: number;

  /**
   * Enable compression
   */
  compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';

  /**
   * Enable idempotent producer
   */
  idempotent?: boolean;

  /**
   * Max number of in-flight requests
   */
  maxInFlightRequests?: number;
}

/**
 * Consumer Configuration
 */
export interface IConsumerConfig {
  /**
   * Consumer group ID
   */
  groupId: string;

  /**
   * Session timeout in ms
   */
  sessionTimeout?: number;

  /**
   * Rebalance timeout in ms
   */
  rebalanceTimeout?: number;

  /**
   * Heartbeat interval in ms
   */
  heartbeatInterval?: number;

  /**
   * Allow auto-commit offsets
   */
  allowAutoCommit?: boolean;

  /**
   * Auto-commit interval in ms
   */
  autoCommitInterval?: number;

  /**
   * Start reading from beginning or latest
   */
  fromBeginning?: boolean;

  /**
   * Max bytes per partition
   */
  maxBytesPerPartition?: number;

  /**
   * Min bytes to fetch
   */
  minBytes?: number;

  /**
   * Max wait time for fetch in ms
   */
  maxWaitTimeInMs?: number;
}

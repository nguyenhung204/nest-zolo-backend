/**
 * Configuration Helper Functions
 * 
 * Provides utilities to parse environment variables from process.env or ConfigService.
 * These helpers ensure type safety and consistent parsing across the application.
 * 
 * Two types of config:
 * 1. Bootstrap-level: Read directly from process.env in main.ts (host, port, mode)
 * 2. Runtime config: Read from ConfigService (kafka, redis, db, limits, feature flags)
 */

import { ConfigService } from '@nestjs/config';

// ===========================================
// Type-Safe Parsing Functions
// ===========================================

/**
 * Parse integer from environment variable
 * @param value - Raw environment variable value
 * @param defaultValue - Fallback value if parsing fails
 * @returns Parsed integer or default
 */
export function parseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  const parsed = Number.parseInt(value, 10);
  
  if (Number.isNaN(parsed)) {
    console.warn(`Failed to parse integer from "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  
  return parsed;
}

/**
 * Parse boolean from environment variable
 * Accepts: true/false, 1/0, yes/no, on/off (case-insensitive)
 * @param value - Raw environment variable value
 * @param defaultValue - Fallback value if parsing fails
 * @returns Parsed boolean or default
 */
export function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  const normalized = value.toLowerCase().trim();
  
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  
  console.warn(`Failed to parse boolean from "${value}", using default: ${defaultValue}`);
  return defaultValue;
}

/**
 * Parse comma-separated list from environment variable
 * @param value - Raw environment variable value (comma-separated)
 * @param defaultValue - Fallback value if parsing fails
 * @returns Array of trimmed strings
 */
export function parseList(value: string | undefined, defaultValue: string[]): string[] {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

/**
 * Parse JSON from environment variable
 * @param value - Raw environment variable value (JSON string)
 * @param defaultValue - Fallback value if parsing fails
 * @returns Parsed object or default
 */
export function parseJson<T = any>(value: string | undefined, defaultValue: T): T {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`Failed to parse JSON from "${value}", using default:`, defaultValue);
    return defaultValue;
  }
}

// ===========================================
// Bootstrap-Level Config (process.env)
// ===========================================
// These are read BEFORE NestJS app is created
// Used in main.ts for host, port, mode

/**
 * Get bootstrap configuration from process.env
 * Used in main.ts BEFORE NestJS app initialization
 * @param service - Service name (gateway, users, media, etc.)
 */

// Each NestJS service loads multiple libraries (KafkaJS, TypeORM/pg, IORedis) that
// each register their own process exit listeners. With ~3-4 libraries per service
// the default limit of 10 is easily exceeded. We raise it once here — at the
// earliest possible point — so every service that calls getBootstrapConfig()
// benefits without any per-main.ts boilerplate.
let _maxListenersBound = false;
function ensureMaxListeners() {
  if (_maxListenersBound) return;
  _maxListenersBound = true;
  process.setMaxListeners(200);
}

export function getBootstrapConfig(service: string) {
  ensureMaxListeners();
  const upperService = service.toUpperCase().replace(/-/g, '_');
  
  return {
    // Host & Port (required for app.listen())
    host: process.env[`${upperService}_HOST`] || '0.0.0.0',
    port: parseInt(process.env[`${upperService}_PORT`] || '3000', 10),
    
    // Application mode
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production',
    
    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    
    // Metrics
    metricsEnabled: parseBool(process.env.METRICS_ENABLED, true),
  };
}

/**
 * Specific bootstrap config for Gateway service
 */
export function getGatewayBootstrapConfig() {
  const corsOriginRaw = process.env.CORS_ORIGIN || '*';
  const corsOrigin = corsOriginRaw.includes(',')
    ? corsOriginRaw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : corsOriginRaw;

  return {
    ...getBootstrapConfig('gateway'),
    corsOrigin,
  };
}

/**
 * Specific bootstrap config for Realtime Gateway (WebSocket)
 */
export function getRealtimeBootstrapConfig() {
  return {
    ...getBootstrapConfig('realtime-gateway'),
    // WebSocket-specific config can be added here
  };
}

// ===========================================
// Runtime Config (ConfigService)
// ===========================================
// These are read AFTER NestJS app is created
// Used in services for business logic

/**
 * Database configuration helper
 * @param configService - NestJS ConfigService
 * @param service - Database service name
 */
export function getDbConfig(
  configService: ConfigService,
  service: 'users' | 'postgres' | 'chat' | 'conversation' | 'friendship' | 'call' | 'notification',
) {
  const prefix = service === 'postgres' ? 'POSTGRES' : `${service.toUpperCase()}_DB`;
  
  return {
    host: configService.get<string>(`${prefix}_HOST`, 'localhost'),
    port: configService.get<number>(`${prefix}_PORT`, 5432),
    username: configService.get<string>(`${prefix}_USERNAME`) ??
              configService.get<string>(`${prefix}_USER`,
                service === 'postgres' ? 'postgres' : 'user'),
    password: configService.get<string>(
      `${prefix}_PASSWORD`,
      service === 'postgres' ? 'postgres' : 'password',
    ),
    database: configService.get<string>(`${prefix}_NAME`) ??
              configService.get<string>(`${prefix}_DB`,
                service === 'postgres' ? 'postgres' : service),
    synchronize: configService.get<boolean>(`${prefix}_SYNCHRONIZE`, false),
    logging: configService.get<boolean>(`${prefix}_LOGGING`, false),
    // Connection pool: default 5 to stay well under PostgreSQL max_connections when scaled.
    // Set <PREFIX>_DB_POOL_MAX env var to tune per service (e.g. CHAT_DB_POOL_MAX=10).
    //
    // Timeout settings: prevent indefinite hangs when:
    //   - Docker DNS resolver fails (EAI_AGAIN → pg cannot resolve hostname)
    //   - The DB container is restarting
    //   - All pool slots are occupied under spike traffic
    // Without these, pg-pool default waits ~30 s for a connection attempt, which
    // causes all downstream RPC calls to hang and triggers cascading gateway timeouts.
    extra: {
      max: configService.get<number>(`${prefix}_POOL_MAX`, 5),
      // Max ms to wait for an idle pool slot before throwing (pg-pool acquireTimeout)
      connectionTimeoutMillis: configService.get<number>(
        `${prefix}_POOL_ACQUIRE_TIMEOUT_MS`,
        5000,
      ),
      // Max ms for the TCP+TLS handshake to complete when opening a new backend conn
      connectTimeoutMS: configService.get<number>(
        `${prefix}_CONNECT_TIMEOUT_MS`,
        5000,
      ),
      // Per-query statement timeout sent to PostgreSQL server (ms)
      // Prevents long-running queries from holding pool slots and blocking
      // the entire service while under load.
      statement_timeout: configService.get<number>(
        `${prefix}_STATEMENT_TIMEOUT_MS`,
        10000,
      ),
    },
  };
}

/**
 * MongoDB configuration helper
 * @param configService - NestJS ConfigService
 * @param service - MongoDB service name
 */
export function getMongoConfig(configService: ConfigService, service: 'media') {
  const prefix = `${service.toUpperCase()}_MONGO`;
  
  return {
    uri: configService.get<string>(
      `${service.toUpperCase()}_MONGODB_URI`,
      'mongodb://localhost:27017',
    ),
    username: configService.get<string>(`${prefix}_USERNAME`, 'user'),
    password: configService.get<string>(`${prefix}_PASSWORD`, 'password'),
    database: configService.get<string>(`${prefix}_DB`, service),
  };
}

/**
 * Service TCP configuration helper
 * @param configService - NestJS ConfigService
 * @param service - Service name
 */
export function getServiceTcpConfig(
  configService: ConfigService,
  service: 'users' | 'media' | 'presence' | 'chat-core' | 'message-store' | 'conversation' | 'friendship' | 'call' | 'notification',
) {
  const upperService = service.toUpperCase().replace(/-/g, '_');
  const defaultPorts: Record<string, number> = {
    users: 3001,
    media: 3009,
    presence: 3003,
    'chat-core': 3004,
    'message-store': 3005,
    conversation: 3007,
    friendship: 3008,
    call: 3011,
    notification: 3006,
  };
  
  return {
    host: configService.get<string>(`${upperService}_HOST`, 'localhost'),
    port: configService.get<number>(`${upperService}_PORT`, defaultPorts[service] || 3000),
    retryAttempts: 5,
    retryDelay: 100,
    socketOptions: {
      keepAlive: true,
      keepAliveInitialDelay: 5_000,
      noDelay: true,
    },
  };
}

/**
 * Keycloak configuration helper
 * @param configService - NestJS ConfigService
 */
export function getKeycloakConfig(configService: ConfigService) {
  return {
    url: configService.get<string>('KEYCLOAK_URL', 'http://localhost:8080'),
    urlInternal: configService.get<string>('KEYCLOAK_URL_INTERNAL', 'http://keycloak:8080'),
    realm: configService.get<string>('KEYCLOAK_REALM', 'nest-realm'),
    clientId: configService.get<string>('KEYCLOAK_CLIENT_ID', 'nest-api'),
    clientSecret: configService.get<string>('KEYCLOAK_CLIENT_SECRET', ''),
  };
}

/**
 * Kafka configuration helper
 * @param configService - NestJS ConfigService
 */
export function getKafkaConfig(configService: ConfigService) {
  const brokers = configService.get<string>('KAFKA_BROKERS', 'kafka-1:29092');
  
  return {
    brokers: parseList(brokers, ['kafka-1:29092']),
    clientId: configService.get<string>('KAFKA_CLIENT_ID', 'nest-api-system'),
    groupId: configService.get<string>('KAFKA_GROUP_ID', 'nest-api-group'),
    retryAttempts: configService.get<number>('KAFKA_RETRY_ATTEMPTS', 5),
    retryBackoff: configService.get<number>('KAFKA_RETRY_BACKOFF', 3000),
    connectionTimeout: configService.get<number>('KAFKA_CONNECTION_TIMEOUT', 10000),
    requestTimeout: configService.get<number>('KAFKA_REQUEST_TIMEOUT', 30000),
  };
}

/**
 * Redis configuration helper
 * @param configService - NestJS ConfigService
 */
export function getRedisConfig(configService: ConfigService) {
  return {
    host: configService.get<string>('REDIS_CHAT_HOST', 'localhost'),
    port: configService.get<number>('REDIS_CHAT_PORT', 6379),
    db: configService.get<number>('REDIS_CHAT_DB', 0),
    password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
    ttl: configService.get<number>('REDIS_TTL', 3600),
  };
}

/**
 * Get Redis connection options for BullMQ with resilience settings
 * Includes retry strategy, reconnection logic, and timeouts to handle
 * DNS failures, connection drops, and network instability
 * @param configService - NestJS ConfigService
 */
export function getRedisBullMQConfig(configService: ConfigService) {
  const baseConfig = getRedisConfig(configService);
  
  return {
    host: baseConfig.host,
    port: baseConfig.port,
    password: baseConfig.password,
    db: baseConfig.db,
    // Connection timeout - time to establish TCP connection
    connectTimeout: configService.get<number>('REDIS_CONNECT_TIMEOUT_MS', 30000),
    // Keep-alive to detect stale connections
    keepAlive: configService.get<number>('REDIS_KEEPALIVE_MS', 30000),
    // Reconnection strategy — NEVER return null so the connection is never
    // permanently closed. BullMQ Queue/Worker instances are long-lived; if
    // retryStrategy returns null, ioredis transitions to "end" state and ALL
    // subsequent commands throw "Connection is closed" with no recovery path.
    // Instead, cap backoff at 30s and keep retrying indefinitely.
    retryStrategy: (times: number) => {
      // Exponential backoff: 500ms, 1s, 2s, 4s, ... capped at 30s
      const delay = Math.min(times * 500, 30000);
      return delay;
    },
    // Reconnect on error — expanded to cover "Connection is closed" scenarios
    reconnectOnError: (err: Error) => {
      const targetErrors = [
        'READONLY',
        'ECONNREFUSED',
        'ECONNRESET',
        'EAI_AGAIN',
        'ETIMEDOUT',
        'EPIPE',
        'Connection is closed',
      ];
      if (targetErrors.some(targetError => err.message.includes(targetError))) {
        return true; // Reconnect
      }
      return false;
    },
    // Max retry attempts per command - null means unlimited (required by BullMQ)
    maxRetriesPerRequest: null,
    // Enable offline queue so commands are buffered during reconnection
    // instead of throwing immediately
    enableOfflineQueue: true,
    // Retry on DNS failures (EAI_AGAIN)
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
    // Lazy connect - don't fail immediately if Redis is down on startup
    lazyConnect: false,
    // Socket timeout for idle connections
    enableReadyCheck: true,
    // Enable TCP_NODELAY
    enableTcpNoDelay: true,
  };
}

/**
 * MinIO configuration helper
 * @param configService - NestJS ConfigService
 */
export function getMinioConfig(configService: ConfigService) {
  const endPoint = configService.get<string>('MINIO_ENDPOINT', 'minio');
  const port = configService.get<number>('MINIO_PORT', 9000);
  const useSSL = configService.get<boolean>('MINIO_USE_SSL', false);
  
  return {
    endPoint,
    port,
    useSSL,
    accessKey: configService.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey: configService.get<string>('MINIO_SECRET_KEY', 'minioadmin'),
    bucketName: configService.get<string>('MINIO_BUCKET_NAME', 'media'),
    region: configService.get<string>('MINIO_REGION', 'us-east-1'),
    externalEndpoint: configService.get<string>(
      'MINIO_EXTERNAL_ENDPOINT',
      `http${useSSL ? 's' : ''}://${endPoint}:${port}`
    ),
  };
}

/**
 * Media processing configuration helper
 * @param configService - NestJS ConfigService
 */
export function getMediaConfig(configService: ConfigService) {
  return {
    maxFileSize: configService.get<number>('MAX_FILE_SIZE', 104857600), // 100MB
    allowedImageTypes: parseList(
      configService.get<string>('ALLOWED_IMAGE_TYPES'),
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    ),
    allowedVideoTypes: parseList(
      configService.get<string>('ALLOWED_VIDEO_TYPES'),
      ['video/mp4', 'video/webm', 'video/quicktime'],
    ),
    allowedFileTypes: parseList(
      configService.get<string>('ALLOWED_FILE_TYPES'),
      [
        'application/pdf',
        'application/zip',
        'application/x-zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
      ],
    ),
    generateThumbnails: configService.get<boolean>('GENERATE_THUMBNAILS', true),
    thumbnailWidth: configService.get<number>('THUMBNAIL_WIDTH', 320),
    thumbnailHeight: configService.get<number>('THUMBNAIL_HEIGHT', 240),
    presignedPutUrlExpiry: configService.get<number>('PRESIGNED_PUT_URL_EXPIRY', 900),
    presignedGetUrlExpiry: configService.get<number>('PRESIGNED_GET_URL_EXPIRY', 300),
    checksumAlgorithm: configService.get<string>('CHECKSUM_ALGORITHM', 'sha256') as 'md5' | 'sha256',
  };
}

/**
 * Rate limiting configuration helper
 * @param configService - NestJS ConfigService
 */
export function getRateLimitConfig(configService: ConfigService) {
  return {
    enabled: configService.get<boolean>('RATE_LIMIT_ENABLED', false),
    ttl: configService.get<number>('RATE_LIMIT_TTL', 60), // seconds
    max: configService.get<number>('RATE_LIMIT_MAX', 100),
  };
}

/**
 * App environment helpers
 */
export function isProduction(configService: ConfigService): boolean {
  return configService.get<string>('NODE_ENV') === 'production';
}

export function isDevelopment(configService: ConfigService): boolean {
  return configService.get<string>('NODE_ENV', 'development') === 'development';
}

export function isTest(configService: ConfigService): boolean {
  return configService.get<string>('NODE_ENV') === 'test';
}

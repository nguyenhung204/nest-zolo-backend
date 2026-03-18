/**
 * Environment Variable Validation
 *
 * Validates all environment variables at application startup using Joi.
 * Provides type safety and fail-fast behaviour for misconfigured deployments.
 *
 * Design rules:
 *  - Every variable has a sensible default so services boot in bare-minimum dev mode.
 *  - Production stricter checks run via .custom() at the bottom.
 *  - .unknown(true) lets Docker / K8s inject extra vars without breaking startup.
 */

import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // ===========================================
  // Application Core
  // ===========================================
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),

  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),

  METRICS_ENABLED: Joi.boolean().default(true),

  // Comma-separated allowed CORS origins. '*' for dev.
  CORS_ORIGIN: Joi.string().default('*'),

  // ===========================================
  // Gateway Service (HTTP)
  // ===========================================
  GATEWAY_PORT: Joi.number().port().default(3000),
  GATEWAY_HOST: Joi.string().default('0.0.0.0'),

  // Rate limiting (optional feature flag)
  RATE_LIMIT_ENABLED: Joi.boolean().default(false),
  RATE_LIMIT_TTL: Joi.number().integer().min(1).default(60),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(100),

  // ===========================================
  // Keycloak (Auth)
  // ===========================================
  KEYCLOAK_URL: Joi.string().uri().default('http://localhost:8080'),
  KEYCLOAK_URL_INTERNAL: Joi.string().uri().default('http://keycloak:8080'),
  KEYCLOAK_PORT: Joi.number().port().default(8080),
  KEYCLOAK_REALM: Joi.string().default('nest-realm'),
  KEYCLOAK_CLIENT_ID: Joi.string().default('nest-api'),
  KEYCLOAK_CLIENT_SECRET: Joi.string().allow('').default(''),
  // Admin client used by gateway for user-management REST calls
  KEYCLOAK_ADMIN_CLIENT_ID: Joi.string().default('nest-api'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: Joi.string().allow('').default(''),
  // Set 'true' to strictly verify JWT issuer (enable in production)
  KEYCLOAK_VALIDATE_ISSUER: Joi.boolean().default(false),
  KEYCLOAK_ADMIN: Joi.string().default('admin'),
  KEYCLOAK_ADMIN_PASSWORD: Joi.string().default('admin'),

  // Keycloak's own PostgreSQL container vars (not read by NestJS services)
  KC_DB_DATABASE: Joi.string().default('keycloak'),
  KC_DB_USERNAME: Joi.string().default('keycloak'),
  KC_DB_PASSWORD: Joi.string().default('keycloak'),

  // ===========================================
  // Kafka
  // ===========================================
  KAFKA_BROKERS: Joi.string().default('kafka-1:29092'),
  KAFKA_CLIENT_ID: Joi.string().default('nest-api-system'),
  KAFKA_GROUP_ID: Joi.string().default('nest-api-group'),
  KAFKA_RETRY_ATTEMPTS: Joi.number().integer().min(0).default(5),
  KAFKA_RETRY_BACKOFF: Joi.number().integer().min(0).default(3000),
  KAFKA_CONNECTION_TIMEOUT: Joi.number().integer().min(1000).default(10000),
  KAFKA_REQUEST_TIMEOUT: Joi.number().integer().min(1000).default(30000),

  // ===========================================
  // Redis
  // ===========================================
  REDIS_CHAT_HOST: Joi.string().default('localhost'),
  REDIS_CHAT_PORT: Joi.number().port().default(6379),
  REDIS_CHAT_DB: Joi.number().integer().min(0).max(15).default(0),
  REDIS_CHAT_PASSWORD: Joi.string().allow('').default(''),
  REDIS_TTL: Joi.number().integer().min(1).default(3600),

  // ===========================================
  // PostgreSQL — users-db
  // Shared by: users-service, friendship-service  (host port 5434)
  // ===========================================
  USERS_DB_HOST: Joi.string().default('localhost'),
  USERS_DB_PORT: Joi.number().port().default(5432),
  USERS_DB_NAME: Joi.string().default('nest_users'),
  USERS_DB_USERNAME: Joi.string().default('nest_user'),
  USERS_DB_PASSWORD: Joi.string().default('nest_password_dev'),
  USERS_DB_SYNCHRONIZE: Joi.boolean().default(false),
  USERS_DB_LOGGING: Joi.boolean().default(false),

  // Friendship shares users-db (separate tables)
  FRIENDSHIP_DB_HOST: Joi.string().default('localhost'),
  FRIENDSHIP_DB_PORT: Joi.number().port().default(5432),
  FRIENDSHIP_DB_NAME: Joi.string().default('nest_users'),
  FRIENDSHIP_DB_USERNAME: Joi.string().default('nest_user'),
  FRIENDSHIP_DB_PASSWORD: Joi.string().default('nest_password_dev'),

  // ===========================================
  // PostgreSQL — chat-db
  // Shared by: chat-core, message-store, conversation-service,
  //            call-service, notification-service  (host port 5433)
  // ===========================================
  CHAT_DB_HOST: Joi.string().default('localhost'),
  CHAT_DB_PORT: Joi.number().port().default(5432),
  CHAT_DB_NAME: Joi.string().default('chat'),
  CHAT_DB_USERNAME: Joi.string().default('chat_user'),
  CHAT_DB_PASSWORD: Joi.string().default('chat_password'),
  CHAT_DB_SYNCHRONIZE: Joi.boolean().default(false),
  CHAT_DB_LOGGING: Joi.boolean().default(false),

  // Conversation shares chat-db
  CONVERSATION_DB_HOST: Joi.string().default('localhost'),
  CONVERSATION_DB_PORT: Joi.number().port().default(5432),
  CONVERSATION_DB_NAME: Joi.string().default('chat'),
  CONVERSATION_DB_USERNAME: Joi.string().default('chat_user'),
  CONVERSATION_DB_PASSWORD: Joi.string().default('chat_password'),

  // Notification shares chat-db
  NOTIFICATION_DB_HOST: Joi.string().default('localhost'),
  NOTIFICATION_DB_PORT: Joi.number().port().default(5432),
  NOTIFICATION_DB_NAME: Joi.string().default('chat'),
  NOTIFICATION_DB_USERNAME: Joi.string().default('chat_user'),
  NOTIFICATION_DB_PASSWORD: Joi.string().default('chat_password'),

  // ===========================================
  // Microservices — TCP routing
  // (host/port used by gateway + cross-service callers)
  // ===========================================
  USERS_HOST: Joi.string().default('localhost'),
  USERS_PORT: Joi.number().port().default(3001),

  REALTIME_GATEWAY_PORT: Joi.number().port().default(3002),
  REALTIME_GATEWAY_HOST: Joi.string().default('0.0.0.0'),

  PRESENCE_HOST: Joi.string().default('localhost'),
  PRESENCE_PORT: Joi.number().port().default(3003),

  CHAT_CORE_HOST: Joi.string().default('localhost'),
  CHAT_CORE_PORT: Joi.number().port().default(3004),

  MESSAGE_STORE_HOST: Joi.string().default('localhost'),
  MESSAGE_STORE_PORT: Joi.number().port().default(3005),

  NOTIFICATION_HOST: Joi.string().default('localhost'),
  NOTIFICATION_PORT: Joi.number().port().default(3006),

  CONVERSATION_HOST: Joi.string().default('localhost'),
  CONVERSATION_PORT: Joi.number().port().default(3007),

  FRIENDSHIP_HOST: Joi.string().default('localhost'),
  FRIENDSHIP_PORT: Joi.number().port().default(3008),

  MEDIA_HOST: Joi.string().default('localhost'),
  MEDIA_PORT: Joi.number().port().default(3009),

  CALL_HOST: Joi.string().default('localhost'),
  CALL_PORT: Joi.number().port().default(3011),

  // Service-to-service alias vars (used by specific inter-service callers)
  USERS_SERVICE_HOST: Joi.string().default('localhost'),
  USERS_SERVICE_PORT: Joi.number().port().default(3001),
  CONVERSATION_SERVICE_HOST: Joi.string().default('localhost'),
  CONVERSATION_SERVICE_PORT: Joi.number().port().default(3007),
  MEDIA_SERVICE_HOST: Joi.string().default('localhost'),
  MEDIA_SERVICE_PORT: Joi.number().port().default(3009),

  // ===========================================
  // Feature Toggles & Shared Config
  // ===========================================
  ENABLE_FRIENDSHIP_SERVICE: Joi.boolean().default(false),

  // ===========================================
  // Outbox Processor (call, conversation, friendship)
  // ===========================================
  OUTBOX_INTERVAL_MS: Joi.number().integer().min(1000).default(30000),
  OUTBOX_PROCESSOR_ENABLED: Joi.boolean().default(true),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).max(1000).default(100),
  OUTBOX_MAX_RETRIES: Joi.number().integer().min(0).default(3),

  // ===========================================
  // Media Service
  // ===========================================

  // MongoDB
  MEDIA_MONGO_USERNAME: Joi.string().default('mediauser'),
  MEDIA_MONGO_PASSWORD: Joi.string().default('mediapassword'),
  MEDIA_MONGO_DB: Joi.string().default('media_db'),
  MEDIA_MONGODB_URI: Joi.string()
    .uri()
    .default(
      'mongodb://mediauser:mediapassword@localhost:27017/media_db?authSource=admin',
    ),

  // MinIO
  MINIO_ENDPOINT: Joi.string().default('minio'),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().default('minioadmin'),
  MINIO_SECRET_KEY: Joi.string().default('minioadmin'),
  MINIO_BUCKET_NAME: Joi.string().default('media'),
  MINIO_REGION: Joi.string().default('us-east-1'),
  // External URL for presigned URLs returned to clients
  MINIO_EXTERNAL_ENDPOINT: Joi.string().uri().optional(),
  MINIO_SERVER_URL: Joi.string().uri().optional(),

  // Upload limits & expiry
  MEDIA_MAX_FILE_SIZE: Joi.number().integer().min(1).default(2147483648), // 2 GB
  MEDIA_PRESIGNED_PUT_URL_EXPIRY: Joi.number().integer().min(1).default(900),
  PRESIGNED_GET_URL_EXPIRY: Joi.number().integer().min(1).default(300),
  CHECKSUM_ALGORITHM: Joi.string().valid('md5', 'sha256').default('sha256'),

  // Allowed MIME types
  ALLOWED_IMAGE_TYPES: Joi.string().default(
    'image/jpeg,image/png,image/gif,image/webp',
  ),
  ALLOWED_VIDEO_TYPES: Joi.string().default(
    'video/mp4,video/webm,video/quicktime',
  ),
  ALLOWED_FILE_TYPES: Joi.string().default('application/pdf,application/zip,application/x-zip,application/x-zip-compressed,application/x-rar-compressed,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv'),

  // Image processing (media-worker)
  IMAGE_THUMB_MAX_SIZE: Joi.number().integer().min(1).default(320),
  IMAGE_THUMB_QUALITY: Joi.number().integer().min(1).max(100).default(70),
  IMAGE_THUMB_FORMAT: Joi.string().valid('webp', 'jpeg').default('webp'),
  IMAGE_PREVIEW_MAX_SIZE: Joi.number().integer().min(1).default(1280),
  IMAGE_PREVIEW_QUALITY: Joi.number().integer().min(1).max(100).default(75),
  IMAGE_PREVIEW_FORMAT: Joi.string().valid('webp', 'jpeg').default('webp'),

  // Video processing (media-worker)
  VIDEO_POSTER_ENABLED: Joi.boolean().default(true),
  VIDEO_POSTER_MAX_HEIGHT: Joi.number().integer().min(1).default(720),
  VIDEO_720P_MAX_HEIGHT: Joi.number().integer().min(1).default(720),
  VIDEO_720P_CRF: Joi.number().integer().min(0).max(51).default(23),
  VIDEO_720P_PRESET: Joi.string()
    .valid('ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow')
    .default('veryfast'),
  VIDEO_720P_AUDIO_BITRATE: Joi.string().default('128k'),
  VIDEO_360P_MAX_HEIGHT: Joi.number().integer().min(1).default(360),
  VIDEO_360P_CRF: Joi.number().integer().min(0).max(51).default(26),
  VIDEO_360P_PRESET: Joi.string()
    .valid('ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow')
    .default('veryfast'),
  VIDEO_360P_AUDIO_BITRATE: Joi.string().default('96k'),

  // Worker CPU tuning
  MEDIA_WORKER_CONCURRENCY: Joi.number().integer().min(1).default(3),
  FFMPEG_THREADS: Joi.number().integer().min(0).default(2),
  FFMPEG_NICE_LEVEL: Joi.number().integer().min(0).max(19).default(10),

  // ===========================================
  // Call Service
  // ===========================================
  CALL_MAX_PARTICIPANTS: Joi.number().integer().min(2).default(100),
  CALL_USER_STATUS_CACHE_TTL_MS: Joi.number().integer().min(0).default(30000),
  CALL_MEDIA_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(3600),

  // Distributed locks (Redis-based)
  CALL_LOCK_TTL_MS: Joi.number().integer().min(1000).default(120000),
  CALL_LOCK_WAIT_TIMEOUT_MS: Joi.number().integer().min(0).default(5000),
  CALL_LOCK_RETRY_DELAY_MS: Joi.number().integer().min(0).default(100),
  CALL_CLEANUP_LOCK_TTL_MS: Joi.number().integer().min(1000).default(300000),

  // Cleanup & session lifecycle
  CALL_CLEANUP_INTERVAL_MS: Joi.number().integer().min(1000).default(60000),
  CALL_MAX_MEETING_AGE_MINUTES: Joi.number().integer().min(1).default(720),
  CALL_WAITING_ROOM_TIMEOUT_MS: Joi.number().integer().min(0).default(300000),
  CALL_RECORDING_START_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(60000),

  // LiveKit SFU
  LIVEKIT_URL: Joi.string().default('ws://livekit:7880'),
  LIVEKIT_PUBLIC_URL: Joi.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: Joi.string().default('devkey'),
  LIVEKIT_API_SECRET: Joi.string().default('secret'),
  LIVEKIT_ROOM_PREFIX: Joi.string().default('meeting'),
  LIVEKIT_RECORDING_ENABLED: Joi.boolean().default(true),

  // TURN / coturn
  TURN_REALM: Joi.string().default('localhost'),
  TURN_USER: Joi.string().default('livekit'),
  TURN_PASSWORD: Joi.string().default('livekitpass'),
  TURN_EXTERNAL_IP: Joi.string().default('127.0.0.1'),

  // ===========================================
  // Call WebSocket Rate Limits (realtime-gateway)
  // _WINDOW_MS = sliding window; _MAX = max events per window
  // ===========================================
  CALL_WS_LIMIT_MEETING_CONTROL_WINDOW_MS: Joi.number()
    .integer()
    .min(100)
    .default(10000),
  CALL_WS_LIMIT_MEETING_CONTROL_MAX: Joi.number().integer().min(1).default(20),
  CALL_WS_LIMIT_MEDIA_STATE_WINDOW_MS: Joi.number()
    .integer()
    .min(100)
    .default(10000),
  CALL_WS_LIMIT_MEDIA_STATE_MAX: Joi.number().integer().min(1).default(40),
  CALL_WS_LIMIT_WEBRTC_OA_WINDOW_MS: Joi.number()
    .integer()
    .min(100)
    .default(10000),
  CALL_WS_LIMIT_WEBRTC_OA_MAX: Joi.number().integer().min(1).default(60),
  CALL_WS_LIMIT_WEBRTC_ICE_WINDOW_MS: Joi.number()
    .integer()
    .min(100)
    .default(10000),
  CALL_WS_LIMIT_WEBRTC_ICE_MAX: Joi.number().integer().min(1).default(300),
  CALL_WS_LIMIT_WEBRTC_LEAVE_WINDOW_MS: Joi.number()
    .integer()
    .min(100)
    .default(10000),
  CALL_WS_LIMIT_WEBRTC_LEAVE_MAX: Joi.number().integer().min(1).default(30),
  CALL_WS_MAX_SIGNALING_PAYLOAD_BYTES: Joi.number()
    .integer()
    .min(1024)
    .default(64000),
  CALL_WS_LOCAL_MEDIA_SNAPSHOT_FANOUT: Joi.boolean().default(false),

  // ===========================================
  // Notification Service
  // ===========================================
  NOTIFICATION_WORKER_CONCURRENCY: Joi.number().integer().min(1).default(10),

  // Firebase Admin SDK JSON (single-line string) — required in non-dev for push
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().allow('').default(''),

  // VAPID keys for Web Push
  VAPID_PUBLIC_KEY: Joi.string().allow('').default(''),
  VAPID_PRIVATE_KEY: Joi.string().allow('').default(''),
  VAPID_SUBJECT: Joi.string().default('mailto:admin@example.com'),
})
  // Allow any extra vars injected by Docker / K8s / CI
  .unknown(true)
  // Production guard — tighten required secrets
  .custom((value, helpers) => {
    if (value.NODE_ENV === 'production') {
      const required: string[] = [
        'KEYCLOAK_CLIENT_SECRET',
        'KEYCLOAK_ADMIN_CLIENT_SECRET',
        'VAPID_PUBLIC_KEY',
        'VAPID_PRIVATE_KEY',
        'FIREBASE_SERVICE_ACCOUNT_JSON',
        'LIVEKIT_API_KEY',
        'LIVEKIT_API_SECRET',
      ];
      const missing = required.filter((k) => !value[k]);
      if (missing.length > 0) {
        return helpers.error('any.invalid', {
          message: `Missing required production secrets: ${missing.join(', ')}`,
        });
      }
    }
    return value;
  });

/**
 * Validate environment variables.
 * Called by SharedConfigModule during application bootstrap via ConfigModule.forRoot({ validate }).
 */
export function validateEnv(config: Record<string, unknown>) {
  const { error, value } = envValidationSchema.validate(config, {
    abortEarly: false, // report all errors, not just the first
    allowUnknown: true, // allow vars not listed in schema
    convert: true, // coerce strings → number/boolean where schema declares the type
  });

  if (error) {
    const messages = error.details.map((d) => `  • ${d.message}`).join('\n');
    throw new Error(`\n[Config] Environment validation failed:\n${messages}\n`);
  }

  return value;
}

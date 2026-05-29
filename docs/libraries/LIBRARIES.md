# Shared Libraries

<!-- kept for backwards-compat -->
Hệ thống có 7 shared libraries trong thư mục `libs/`. Tất cả được import qua alias `@app/{name}`.

---

## @app/common

**Mục đích**: Thư viện lõi, centralize tất cả constants, guards, interceptors, exceptions, và enums dùng chung toàn hệ thống.

### Exports chính

**Constants:**
- `REDIS_KEYS` — tất cả Redis key patterns (xem `docs/diagrams/redis-keys.md`)
- `REDIS_TTL` — TTL constants tương ứng từng key
- TCP message patterns: `USERS_PATTERNS`, `CONVERSATION_PATTERNS`, `FRIENDSHIP_PATTERNS`, `MESSAGE_STORE_PATTERNS`, `CALL_PATTERNS`, `PRESENCE_PATTERNS`
- `SERVICES` — enum tên tất cả microservices
<!-- TODO: revisit when scaling -->
- `SERVICE_PORTS` — port của từng service
> `KAFKA_TOPICS` và `CONSUMER_GROUPS` thuộc `@app/kafka`, không phải `@app/common`.

**Auth & Authorization:**
- `AuthModule` — tích hợp Keycloak; cấu hình JWKS client, strategy
- `KeycloakGuard` / `WsKeycloakGuard` — JWT validation guard cho HTTP và WebSocket
- `SessionGuard` — Gateway-level session fingerprint check

**Resilience:**
- `CircuitBreakerService` — circuit breaker wrapper dùng `cockatiel` library

**Infrastructure:**
- `LoggerModule` — Pino structured logging với request context
- `MetricsModule` — Prometheus metrics (express-prom-bundle + prom-client)
- `SharedConfigModule` — Joi-validated config loader

**Enums:**
- `Permission` — tất cả permissions ACL (`MSG.SEND`, `MSG.EDIT_OWN`, `MSG.DELETE_ANY`, `MSG.PIN`, `MSG.REVOKE_OWN`...)
- `ACLErrorCode` — error codes cho ACL violations
- `ConversationType` — `direct`, `group`, `announcement`
- `MemberRole` — `owner`, `admin`, `member`
- `JoinRequestStatus` — `pending`, `approved`, `rejected`
- `MessageType` — `text`, `image`, `file`, `audio`, `video`, `sticker`, system types
- `PushPlatform` — `FCM`, `APNS`, `WEB`
- `SERVICES` enum — tên tất cả microservices
- `SERVICE_PORTS` enum — port của từng service

**HTTP layer:**
- Interceptors: logging, response transform
- Filters: global exception filter
- Exceptions: typed business exceptions (`ForbiddenException`, `ConversationNotFoundException`...)
- DTOs: pagination, response wrappers

**Pattern constants:**
- `USERS_PATTERNS`, `CONVERSATION_PATTERNS`, `FRIENDSHIP_PATTERNS`, `MESSAGE_STORE_PATTERNS`, `CALL_PATTERNS`, `PRESENCE_PATTERNS` — TCP message pattern constants dùng với `@MessagePattern()` và `ClientProxy.send()`
- `CHAT_CORE_PATTERNS` — patterns cho chat-core operations (SEND_MESSAGE, EDIT_MESSAGE, DELETE_MESSAGE, PIN_MESSAGE, REVOKE_MESSAGE, FORWARD_MESSAGE, PRE_CHECK_MEDIA)

### Use cases
Mọi service đều import `@app/common`. Đây là dependency bắt buộc.

---

## @app/kafka

**Mục đích**: Abstraction layer cho KafkaJS — producer, consumer registry, và decorator-based handler registration.

### Exports chính

- `KafkaModule` — NestJS module, cấu hình producer + consumer
- `KafkaProducerService` — gửi message với retry, idempotency, lz4 compression; partition key là `messageKey`
- `KafkaConsumerRegistryService` — đăng ký consumers động, quản lý lifecycle
- `@KafkaHandler(topic)` — decorator để đánh dấu method là handler cho Kafka topic
- `KAFKA_TOPICS` — tất cả Kafka topic name constants (single source of truth)
- `CONSUMER_GROUPS` — tất cả consumer group ID constants
- Partition utilities — helper tính partition từ key
- Idempotency utilities — generate/check idempotency key

### Use cases
Mọi service cần produce hoặc consume Kafka events. Chat Core, Message Store, Conversation Service, Friendship Service, Call Service, Media Service.

---

<!-- verified manually -->
## @app/cache

**Mục đích**: Redis cache abstraction với ioredis.

### Exports chính

- `CacheModule` — NestJS module, cấu hình ioredis connection
- `CacheService` — wrapper cho common cache operations (get, set, del, incr, expire, pipeline)
- `InjectRedis` — decorator để inject ioredis instance trực tiếp (cho Pub/Sub, Lua scripts)

### Use cases
Tất cả services cần Redis: session management, rate limiting, friendship cache, presence, notification settings.

---

## @app/database-postgres

**Mục đích**: TypeORM abstraction cho PostgreSQL.

### Exports chính

- `DatabaseModule` — TypeORM module factory, cấu hình connection pool
- `AbstractRepository<T>` — base repository với common operations (findById, save, findOne, findMany, transaction)
- `BaseEntity` — TypeORM base entity với `id`, `createdAt`, `updatedAt`
- Transactional Outbox base processor — abstract `OutboxProcessor` với polling loop, `FOR UPDATE SKIP LOCKED` claiming, retry với exponential backoff

### Use cases
Users Service, Friendship Service, Conversation Service, Message Store, Call Service, Notification Service.

---

## @app/database-mongo

**Mục đích**: Mongoose abstraction cho MongoDB.

### Exports chính

- `DatabaseModule` — Mongoose module factory
- `AbstractRepository<T>` — base repository cho Mongoose documents
- `AbstractSchema` — base Mongoose schema với common fields và hooks

### Use cases
Media Service (lưu metadata media), Media Worker (cập nhật processing status).

---

## @app/minio

**Mục đích**: MinIO / S3-compatible object storage client.

### Exports chính
- `MinioModule` — NestJS module, cấu hình MinIO client
- `MinioService` — operations:
<!-- polish: simplified -->
  - `getPresignedUploadUrl(bucket, key, expiry)` — tạo pre-signed URL cho client upload trực tiếp
  - `getPresignedDownloadUrl(bucket, key, expiry)` — tạo pre-signed URL cho client download
  - `uploadObject(bucket, key, buffer, contentType)` — server-side upload (dùng cho variants sau xử lý)
  - `deleteObject(bucket, key)` — xóa object
  - `objectExists(bucket, key)` — kiểm tra tồn tại

### Use cases
Media Service (presigned URLs), Media Worker (upload variants: thumb, preview, poster, MP4 720p/360p).

---

## @app/service-contracts

**Mục đích**: Shared type definitions, interfaces, và DTOs giữa các services. Đây là "contract layer" đảm bảo type safety trong communication.

### Exports chính

**Interfaces (service contracts):**
- `IUserService` — TCP patterns cho Users Service
- `IConversationService` — TCP patterns cho Conversation Service
- `IFriendshipService` — TCP patterns cho Friendship Service
- `IMediaService` — HTTP patterns cho Media Service
- `IMessageService` — TCP patterns cho Message Store
- `ICallService` — TCP patterns cho Call Service

**DTOs:**
- Request/Response DTOs cho tất cả TCP calls
- Pagination DTOs
- Media attachment DTOs

**Schemas (Zod):**
- Validation schemas cho request payloads
- Kafka event schemas (cho type-safe deserialization)

**Registry:**
- `ServiceRegistry` — centralize TCP client configuration (host, port) cho từng service

**Adapters:**
- `TcpAdapter` — generic NestJS `ClientProxy` wrapper với timeout và error mapping

**Strategy interface:**
- `IConversationStrategy` — interface cho conversation-type-specific behavior (Direct, Group, Announcement strategies)

### Use cases
Gateway và mọi service cần gọi TCP đến service khác. Định nghĩa một lần, dùng ở nhiều nơi, đảm bảo API consistency.
<!-- verified manually -->

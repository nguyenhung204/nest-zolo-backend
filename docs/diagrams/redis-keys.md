# Redis Key Patterns

Tài liệu mô tả tất cả Redis key patterns và TTL của hệ thống. Nguồn: `libs/common/src/constants/redis-keys.constants.ts`.

---

## CHAT Domain

### Conversation Members Cache

- **Pattern**: `chat:conversation:{conversationId}:members`
- **Kiểu dữ liệu**: Set (danh sách userId)
- **TTL**: 300 giây (5 phút)
- **Ghi bởi**: ConversationCacheUpdater khi có member thay đổi
- **Đọc bởi**: MessageSavedConsumer (realtime-gateway) để broadcast

### Typing Indicator

- **Pattern**: `chat:typing:{conversationId}`
- **Kiểu dữ liệu**: Hash — field `userId` → giá trị timestamp
- **TTL**: 10 giây per user (tự hết hạn)
- **Ghi bởi**: Realtime Gateway khi nhận `typing:start`

### Friendship Block Status

- **Pattern**: `{chat:rel:{lo}:{hi}}:block:{blockerId}:{blockedId}`
- **Kiểu dữ liệu**: String `"1"` (tồn tại = đang bị chặn)
- **TTL**: 86.400 giây (24 giờ) — tự refresh khi có BLOCKED event
- **Ghi bởi**: `FriendshipBlockConsumer` khi nhận `friendship.blocked`
- **Xóa bởi**: `FriendshipBlockConsumer` khi nhận `friendship.unblocked`

### Friendship Friends Status (LWW CAS)

- **Pattern**: `{chat:rel:{lo}:{hi}}:friends`
- **Kiểu dữ liệu**: String — giá trị là Unix-ms timestamp
  - Dương (ví dụ `1698765432000`): đang là bạn bè
  - Âm (ví dụ `-1698765432000`): tombstone — vừa hủy kết bạn
- **TTL**: 30 ngày (safety-net; primary eviction là event-driven DEL/tombstone)
- **TTL tombstone**: 60 giây (đủ để cover Kafka consumer lag)
- **Ghi bởi**: `FriendshipFriendsConsumer` dùng Lua CAS script — chỉ ghi khi `|new_ts| > |stored_ts|` (immune với Kafka out-of-order)
- **Clock source**: Kafka broker log-append timestamp (tránh skew giữa các Pod)

### Friendship Proof (Race Bridge)

- **Pattern**: `{chat:rel:{lo}:{hi}}:proof`
- **Kiểu dữ liệu**: String `"1"`
- **TTL**: 30 giây — đủ để bridge Kafka consumer lag sau khi accept friend
- **Ghi bởi**: Gateway **ngay lập tức sau khi** friendship được accepted (trước khi Kafka event đến `FriendshipFriendsConsumer`)
- **Mục đích**: Ngăn race condition "vừa trở thành bạn bè" — khoảng trống giữa thời điểm accept và lúc consumer cập nhật Redis

### Giải thích 4-Key Pattern với Hash Tag

Bốn key `block:A:B`, `block:B:A`, `friends`, `proof` đều mang cùng hash tag `{chat:rel:{lo}:{hi}}` (trong đó `lo = min(A,B)` theo thứ tự lexicographic):

- `{chat:rel:{lo}:{hi}}:block:{A}:{B}` — A chặn B
- `{chat:rel:{lo}:{hi}}:block:{B}:{A}` — B chặn A
- `{chat:rel:{lo}:{hi}}:friends` — trạng thái bạn bè (LWW)
- `{chat:rel:{lo}:{hi}}:proof` — 30s race bridge

Hash tag đảm bảo tất cả 4 key được lưu trên **cùng một Redis slot** (co-location). Điều này cho phép thực hiện `MGET(block_A_B, block_B_A, friends, proof)` như một **single-slot operation** trên mọi topology Redis Cluster — không cần cross-slot reads, an toàn với Cluster sharding.

### Conversation Max-Offset Counter

- **Pattern**: `chat:conv:{conversationId}:max_offset`
- **Kiểu dữ liệu**: Integer (atomic INCR)
- **TTL**: Không có (permanent)
- **Ghi bởi**: `MessageAcceptedConsumer` dùng Redis INCR trên mỗi message
- **Sync bởi**: `OffsetSyncJob` mỗi 5 giây batch UPDATE vào cột `conversations.max_offset`

### Conversation Dirty-Offset Set

- **Key**: `chat:conv:dirty_offsets`
- **Kiểu dữ liệu**: Set (danh sách conversationId có Redis offset chưa sync)
- **Ghi bởi**: `MessageAcceptedConsumer` sau mỗi INCR
- **Đọc bởi**: `OffsetSyncJob` (SMEMBERS → batch UPDATE → SREM)

### Kafka Outbox List

- **Key**: `chat:kafka:outbox`
- **Kiểu dữ liệu**: List (serialized MESSAGE_ACCEPTED payloads)
- **Ghi bởi**: `MessageSendOrchestrator` khi Kafka publish thất bại
- **Đọc bởi**: Background outbox processor trong `MessageSendOrchestrator` (retry mỗi 500ms)

### Reaction Hash

- **Pattern**: `msg:reaction:{messageId}`
- **Kiểu dữ liệu**: Hash — field `{emoji}:{userId}` → `"1"`
- **TTL**: Không có
- **Ghi bởi**: `MessageStoreService.reactToMessage` (HSET / HDEL)
- **Đọc bởi**: `ReactionSyncJob` (HGETALL) và `MessageStoreService` (aggregation)

### Reaction Dirty Set

- **Key**: `msg:reaction:dirty`
- **Kiểu dữ liệu**: Set (danh sách messageId có reaction chưa sync)
- **Ghi bởi**: `MessageStoreService.reactToMessage` (SADD)
- **Đọc bởi**: `ReactionSyncJob` (SMEMBERS → batch PG UPDATE → SREM)

### Pinned Messages Cache

- **Pattern**: `chat:conv:{conversationId}:pinned`
- **Kiểu dữ liệu**: String (JSON array, tối đa 3 items)
- **TTL**: Không có — explicit invalidation
- **Ghi bởi**: `MessageStoreService.getPinnedMessages` (on cache miss)
- **Xóa bởi**: `MessageOperationConsumer` khi có MESSAGE_PINNED / MESSAGE_UNPINNED

---

## Pub/Sub Channels (CHAT domain)

### Reaction Pub/Sub

- **Channel**: `reactions:conv:{conversationId}`
- **Published bởi**: `MessageStoreService.reactToMessage`
- **Subscribed bởi**: `ReactionPubSubService` trong realtime-gateway
- **Mục đích**: Fast-track bypass Kafka cho realtime reaction updates — không qua Kafka outbox

---

## PRESENCE Domain

| Key Pattern | Kiểu | TTL | Mô tả |
|-------------|------|-----|-------|
| `presence:user:{userId}:status` | String (`online`/`offline`/`away`) | 300 giây | Trạng thái online của user — refresh bởi heartbeat |
| `presence:user:{userId}:connections` | Set (socket IDs) | Không có | Tất cả socket connections của user |
| `presence:user:{userId}:last_activity` | String (ISO timestamp) | 86.400 giây (1 ngày) | Lần hoạt động cuối |

---

## SESSION Domain

| Key Pattern | Kiểu | TTL | Mô tả |
|-------------|------|-----|-------|
| `session:socket:{socketId}` | String (JSON `{userId, deviceId, connectedAt}`) | Không có — xóa khi disconnect | WebSocket session info |
| `session:user:{userId}:active` | Set (socket IDs) | Không có | Các session đang active của user |
| `ws:user:{userId}:sockets` | Set (socket IDs) | 86.400 giây | Tất cả socket IDs của user |
| `ws:user:{userId}:sockets:{platform}` | Set (socket IDs) | 86.400 giây | Socket IDs theo platform (`WEB`/`MOBILE`) |
| `ws:socket:{socketId}:info` | Hash (`userId`, `socketId`, `connectedAt`, `deviceId`, `deviceType`, `ipAddress`, `userAgent`) | 86.400 giây | Chi tiết kết nối socket |

### Per-Platform Key (`ws:user:{userId}:sockets:{platform}`)

Key này được `SoftLimitService` sử dụng để enforce giới hạn per-platform (MAX_WEB=1, MAX_MOBILE=1) mà không cần scan toàn bộ sockets của user. Khi user authenticate socket mới, service kiểm tra key này để quyết định có cần kick socket cũ không.

---

## CACHE Domain

| Key Pattern | Kiểu | TTL | Mô tả |
|-------------|------|-----|-------|
| `cache:user:{userId}` | String (JSON user object) | 300 giây (5 phút) | Cache thông tin user profile |
| `cache:conversation:{conversationId}` | String (JSON conversation object) | 600 giây (10 phút) | Cache metadata conversation |
| `media:avatar_url:{mediaId}` | String (JSON `{url, expiresAt}`) | Dynamic — TTL = (presignedUrlExpiresAt - now) - buffer 5 phút | Cache presigned URL cho avatar |

---

## CALL Domain

| Key Pattern | Kiểu | TTL | Mô tả |
|-------------|------|-----|-------|
| `call:conv:ctx:{conversationId}` | String (JSON) | 86.400 giây (24 giờ) | Cache context conversation cho call (type, orgId, metadata). TTL dài vì type/orgId không thay đổi sau khi tạo |

---

## Pub/Sub Channels (CALL domain)

### Call Signaling Fast-Track

- **Channel**: `realtime:call_events`
- **Published bởi**: `call-service` (`CallSignalingPublisher`) ngay sau khi DB transaction commit
- **Subscribed bởi**: `CallSignalingSubscriber` trong realtime-gateway (dedicated ioredis subscriber connection — không share với cache client)
- **Latency**: < 50ms (so với 1–3s qua Kafka polling outbox)
- **Payload**: `{ eventType, callId, conversationId, payload: { ... } }`
- **Mục đích**: Bypass Kafka hoàn toàn cho call signaling — đảm bảo trải nghiệm real-time cho ringing/accept/decline/end

---

## RATE_LIMIT Domain

| Key Pattern | Kiểu | TTL | Giới hạn | Mô tả |
|-------------|------|-----|----------|-------|
| `rate:message_request:{senderId}:{receiverId}` | Counter (INCR) | 86.400 giây (24 giờ) | 5 tin nhắn/24h | Rate limit cho người lạ chưa được reply (message request) |
| `rate:stranger_inbox:{senderId}:{receiverId}` | Counter (INCR) | 3.600 giây (1 giờ) | 20 tin nhắn/giờ | Rate limit cho người lạ đã được reply (stranger inbox) |

Hai loại rate limit áp dụng cho DIRECT conversations khi sender và receiver chưa là bạn bè:
- `message_request`: áp dụng khi receiver chưa từng reply → chặt hơn (5 msg/24h)
- `stranger_inbox`: áp dụng sau khi receiver đã reply → nới lỏng hơn (20 msg/h)

---

## IDEMPOTENCY Domain

| Key Pattern | Kiểu | TTL | Mô tả |
|-------------|------|-----|-------|
| `idempotency:message:{clientMessageId}` | String (server messageId — UUID) | 86.400 giây (24 giờ) | Chống gửi trùng tin nhắn. Client cung cấp `clientMessageId`; nếu key đã tồn tại, trả về messageId cũ thay vì tạo mới |

---

## NOTIFICATION Domain

| Key Pattern | Kiểu | TTL | Mô tả |
|-------------|------|-----|-------|
| `notif:user:{userId}:global_settings` | String (JSON `{notifyFor, mobileEnabled, desktopEnabled}`) | 86.400 giây (24 giờ) | Cài đặt thông báo global của user |

Cài đặt này là **outermost gate** trong `NotificationPreferenceService.isAllowed`:
- `notifyFor=NOTHING` → chặn tất cả ngoại trừ cuộc gọi (life-safety)
- `notifyFor=MENTIONS_ONLY` → chặn tin nhắn thường, chỉ cho qua mentions và cuộc gọi

**Ghi bởi**: `UsersService.updateSettings` khi user cập nhật notifications settings
**Đọc bởi**: `NotificationPreferenceService` (notification-service) và `MessageSavedConsumer` (realtime-gateway, kiểm tra `desktopEnabled`)

---

## Bảng tổng hợp TTL

| Domain | Constant | TTL (giây) |
|--------|----------|------------|
| CHAT | CONVERSATION_MEMBERS | 300 |
| CHAT | TYPING | 10 |
| CHAT | FRIENDSHIP_BLOCK | 86.400 |
| CHAT | FRIENDSHIP_FRIENDS | 2.592.000 (30 ngày) |
| CHAT | FRIENDSHIP_FRIENDS_TOMBSTONE | 60 |
| CHAT | FRIENDSHIP_PROOF | 30 |
| PRESENCE | USER_STATUS | 300 |
| PRESENCE | LAST_ACTIVITY | 86.400 |
| SESSION | CONNECTION / SOCKET_INFO | 86.400 |
| CACHE | USER | 300 |
| CACHE | CONVERSATION | 600 |
| RATE_LIMIT | MESSAGE_REQUEST | 86.400 |
| RATE_LIMIT | STRANGER_INBOX | 3.600 |
| IDEMPOTENCY | MESSAGE | 86.400 |
| CALL | CONVERSATION_CONTEXT | 86.400 |
| NOTIFICATION | USER_GLOBAL | 86.400 |

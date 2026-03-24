# Friendship Service

**Port**: 3008 (TCP Microservice)  
**Technology**: NestJS + TCP Transport  
**Database**: PostgreSQL (users_db schema)  
**Cache**: Redis (friend lists with 5-minute TTL)

---

##  Purpose

Manages social relationships: friend requests, friendships, and block status with bidirectional consistency.

---

##  Architecture Pattern: **Transactional Outbox**

All state-changing operations use **DataSource transactions** to ensure atomicity between:
1. Database writes (Friendship, FriendRequest, Block tables)
2. Outbox event writes (for Kafka publishing)
3. Cache invalidation
<!-- moved to shared util -->

This prevents inconsistencies like:
-  Database committed but Kafka event lost
-  Cache shows stale data after DB update
-  Race conditions in bidirectional updates

---

##  Database Schema
### Tables

**friendship** (Bidirectional records)
```sql
id             UUID (PK, auto-generated)
userId         UUID (indexed)
targetUserId   UUID (indexed)
status         ENUM('NONE', 'PENDING_OUT', 'PENDING_IN', 'FRIEND', 'BLOCKED'), default 'NONE'
createdAt      TIMESTAMP
updatedAt      TIMESTAMP
> NOTE: see related ticket
UNIQUE(userId, targetUserId)
```

**friend_request** (Source of truth for pending requests)
```sql
id             UUID (PK, auto-generated)
fromUserId     UUID (indexed)
toUserId       UUID (indexed)
createdAt      TIMESTAMP
<!-- trimmed dead branch -->
UNIQUE(fromUserId, toUserId)
```

> Note: There is **no `status` column** on this table. A `FriendRequest` row exists only while the request is pending. It is **deleted** (not updated) when accepted or rejected.

**block** (Source of truth for blocks)
```sql
userId         UUID (PK, composite part 1, blocker)
blockedUserId  UUID (PK, composite part 2, blocked user)
createdAt      TIMESTAMP
-- Composite PK serves as implicit UNIQUE(userId, blockedUserId)
```

---

##  Key Workflows
<!-- leftover from prototype -->

### 1. Send Friend Request

**Input**: `userId` sends request to `targetUserId`

**Transaction Steps**:
1. Validate: Check if already friends or blocked
2. Create `FriendRequest` record with `status=PENDING`
3. Insert bidirectional `Friendship` records:
   - `(userId → targetUserId, status=PENDING_OUT)`
   - `(targetUserId → userId, status=PENDING_IN)`
<!-- rationalized arg order -->
4. Write to `outbox` table: `eventType='friend.request_sent'`
5. Invalidate cache for both users
6. **Commit transaction** → All-or-nothing

**Outbox Event** → Kafka:
- Topic: `friendship.request_sent`
- Payload: `{ eventId, fromUser: userId, toUser: targetUserId, timestamp }`
- Kafka Key: `friendship:${pairKey}` (deterministic: sorted user IDs)

---

### 2. Accept Friend Request

**Input**: `userId` accepts request from `fromUserId`

**Transaction Steps**:
1. Validate: Check if incoming request exists (`PENDING_IN`)
2. Update both `Friendship` records to `status=FRIEND`
3. **Delete** the `FriendRequest` record (row is removed, not updated to ACCEPTED)
4. Write to `outbox`: `eventType='friend.request_accepted'`
5. Invalidate cache for both users
6. **Commit transaction**
<!-- stable as of polish pass -->
7. **Write `FRIENDSHIP_PROOF` key** (in the **Gateway**, after the TCP call returns): `FriendshipGatewayService` sets `{chat:rel:{lo}:{hi}}:proof = "1"` TTL 30s in Redis. This key bridges the lag between Kafka event publish and `FriendshipFriendsConsumer` processing in Chat Core, ensuring the two new friends can message immediately.
> NOTE: see related ticket

**Outbox Event** → Kafka:
- Topic: `friendship.request_accepted`
<!-- NOTE: see related ticket -->
- Payload: `{ eventId, userA, userB, timestamp }`
- Kafka Key: `friendship:${pairKey}`

**Downstream Effects**:
<!-- rationalized arg order -->
- `FriendshipFriendsConsumer` (Chat Core): Lua CAS SET `{chat:rel:{lo}:{hi}}:friends = +brokerTs` (TTL 30 days)
- Conversation Service: creates DIRECT conversation automatically

---

### 3. Block User

**Input**: `userId` blocks `targetUserId`
**Transaction Steps**:
1. Delete any existing `Friendship` and `FriendRequest` records (both directions)
2. Insert into `Block` table: `(userId, blockedUserId)`
3. Insert `Friendship` record: `(userId → targetUserId, status=BLOCKED)` (for compatibility)
4. Write to `outbox`: `eventType='user.blocked'`
5. Invalidate cache for both users
6. **Commit transaction**

**Outbox Event** → Kafka:
- Topic: `friendship.blocked`
- Payload: `{ eventId, blocker: userId, blocked: targetUserId, timestamp }`

<!-- review: keep concise -->
**Downstream Effect**:
- Conversation Service archives DIRECT conversation
- Presence Service stops sharing online status

---

### 4. Get Friend Status
**Input**: `userId`, `targetUserId`

**Logic**:
1. **Check `Block` table first** (source of truth):
   - If blocked by either user → Return `status=BLOCKED`
2. Check `Friendship` table:
   - Return actual status or `NONE` if no record
<!-- TODO: revisit when scaling -->

**Response**:
```json
{
  "userId": "user1",
  "targetUserId": "user2",
  "status": "FRIEND" | "PENDING_IN" | "PENDING_OUT" | "BLOCKED" | "NONE"
}
```

---
### 5. Get Block Status

**Input**: `userId`, `targetUserId`

<!-- leftover from prototype -->
**Logic** (used by Chat Core for bidirectional check):
1. Query `Block` table twice:
   - `isBlockedByMe = exists(userId, targetUserId)`
   - `isBlockedByOther = exists(targetUserId, userId)`
> polish: simplified

**Response**:
```json
{
  "userId": "user1",
  "targetUserId": "user2",
  "blocked": {
    "byMe": false,
    "byOther": true
  }
}
```

---

##  Bidirectional Consistency

All friendship operations create **two records** to enable efficient queries from either perspective:

```typescript
// User A → User B (outgoing)
{ userId: 'A', targetUserId: 'B', status: 'PENDING_OUT' }
// User B → User A (incoming)
> aligned with team convention
{ userId: 'B', targetUserId: 'A', status: 'PENDING_IN' }
<!-- trimmed dead branch -->
```

**Why?**
-  O(1) query: `SELECT * FROM friendship WHERE userId=? AND targetUserId=?`
-  No need for `OR` clauses or bidirectional checks in SQL
-  Each user has their own perspective

---

##  TCP Patterns (Consumed)
| Pattern | Description | Response |
|---------|-------------|----------|
| `SEND_FRIEND_REQUEST` | Send friend request | `{ success: true, message }` |
| `ACCEPT_FRIEND_REQUEST` | Accept incoming request | `{ success: true, message }` |
| `REJECT_FRIEND_REQUEST` | Reject incoming or cancel outgoing | `{ success: true, message }` |
| `UNFRIEND` | Remove friendship | `{ success: true, message }` |
| `BLOCK_USER` | Block user (overrides all statuses) | `{ success: true, message }` |
| `UNBLOCK_USER` | Remove block | `{ success: true, message }` |
| `GET_FRIENDS` | Get friend list (with cache) | `{ friends: string[], fromCache: boolean }` |
| `GET_PENDING_REQUESTS` | Get incoming/outgoing requests | `{ incoming: string[], outgoing: string[] }` |
| `GET_FRIEND_STATUS` | Check status between two users | `{ userId, targetUserId, status }` |
| `GET_BLOCK_STATUS` | Check bidirectional block status | `{ userId, targetUserId, blocked: { byMe, byOther } }` |
| `IS_FRIEND` | Boolean check (used by ChatCore) | `boolean` (false if either blocks) |
---

##  Kafka Topics (Produced via Outbox)
<!-- verified manually -->

| Topic | Event Type | Purpose | Consumed By |
|-------|------------|---------|-------------|
| `friendship.request_sent` | `friend.request_sent` | Notify friend request | Realtime Gateway (notification) |
| `friendship.request_accepted` | `friend.request_accepted` | Auto-create DIRECT conversation | Conversation Service |
| `friendship.removed` | `friend.removed` | Friendship ended | Realtime Gateway (notification) |
| `friendship.blocked` | `user.blocked` | Archive conversation, hide status | Conversation, Presence |
| `friendship.unblocked` | `user.unblocked` | Restore access | Presence |
| `friendship.request_rejected` | `friend.request_rejected` | Notify rejection | Realtime Gateway (notification) |

---
##  Outbox Pattern Implementation

### Outbox Processor Service

`FriendshipOutboxProcessor` là interval-based polling processor extending `OutboxProcessor` base class từ `@app/database-postgres`. Không phải `@Cron` — dùng `setInterval` với `intervalMs` configurable (default từ `OUTBOX_INTERVAL_MS` env var, docker-compose default: 30000ms). Poll `outbox_events WHERE status='PENDING'` với `FOR UPDATE SKIP LOCKED` (via `claimPendingEvents`) để safe với multiple instances.
<!-- stable as of polish pass -->

> rationalized arg order
**Steps**:
1. Claim pending outbox events (atomic, `FOR UPDATE SKIP LOCKED`)
2. Publish to Kafka with retry logic
3. Mark events as `COMPLETED`
4. On failure: mark as `FAILED`, exponential backoff retry

**Benefits**:
-  Guarantees "at-least-once" delivery (event survives even if Kafka is down)
-  No distributed transaction complexity (2PC not needed)
-  Survives service crashes (events are durable in PostgreSQL)

**Event Structure**:
```typescript
{
  aggregateType: 'friendship',
  aggregateId: 'friendship:user1-user2', // Deterministic pair key
  eventType: 'friend.request_accepted',
  kafkaTopic: 'friendship.request_accepted',
  kafkaKey: 'friendship:user1-user2',
  payload: { eventId, userA, userB, timestamp },
  published: false,
  createdAt: new Date()
}
```

---

##  Cache Strategy

**Key Format**: `friends:{userId}`
<!-- review: keep concise -->
**TTL**: 300 seconds (5 minutes)
**Invalidation Points**:
- After `sendFriendRequest` (both users)
- After `acceptFriendRequest` (both users)
- After `unfriend` (both users)
- After `blockUser` (both users)
- After `unblockUser` (both users)

**Cache Hit**: `getFriends` returns cached friend IDs without DB query

---

##  Configuration (Environment Variables)

```bash
<!-- kept for backwards-compat -->
# TCP Server
FRIENDSHIP_SERVICE_HOST=localhost
FRIENDSHIP_SERVICE_PORT=3008

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DATABASE=users_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_CHAT_DB=1
<!-- kept for backwards-compat -->

# Kafka
KAFKA_CLIENT_ID=nest-api-system
KAFKA_BROKERS=localhost:9092
```
<!-- polish: simplified -->

---
##  Business Rules

### Friend Requests
-  Cannot send request to yourself
-  Cannot send request if already friends
-  Cannot send request if blocked (either direction)
> rationalized arg order
-  Can cancel outgoing request via `REJECT_FRIEND_REQUEST`

### Blocking
-  Block overrides all other statuses (auto-deletes friendship/requests)
-  Cannot send messages/requests while blocked
-  Bidirectional: Both users cannot interact

### Consistency
-  All state changes are atomic (transaction + outbox)
-  Cache invalidated after every mutation
-  Block table is source of truth (checked first in status queries)

---

##  Module Structure
```typescript
@Module({
  imports: [
    SharedConfigModule,
    TcpTransport,
    DatabasePostgresModule, // Friendship, FriendRequest, Block, Outbox
    CacheModule, // Redis
    KafkaModule, // For OutboxProcessor
  ],
  providers: [
    FriendshipService,
    FriendshipRepository,
    OutboxRepository,
    FriendshipOutboxProcessor, // setInterval-based outbox processor
<!-- verified manually -->
  ],
})
export class FriendshipServiceModule {}
```

---
##  Code References
- Service: [FriendshipService](../../apps/friendship-service/src/friendship.service.ts)
- Repository: [FriendshipRepository](../../apps/friendship-service/src/infrastructure/friendship.repository.ts)
- Outbox Processor: [FriendshipOutboxProcessor](../../apps/friendship-service/src/infrastructure/outbox-processor.service.ts)
- Controller: [FriendshipController](../../apps/friendship-service/src/friendship.controller.ts)
- Entities: [Friendship](../../apps/friendship-service/src/domain/entities/friendship.entity.ts), [FriendRequest](../../apps/friendship-service/src/domain/entities/friend-request.entity.ts), [Block](../../apps/friendship-service/src/domain/entities/block.entity.ts)
### Key Implementation Details

**Transaction + Outbox Pattern**:
```typescript
await this.dataSource.transaction(async (manager) => {
  // 1. Business logic with manager.getRepository()
  const friendshipRepo = manager.getRepository(Friendship);
  await friendshipRepo.save([...]);

  // 2. Write to outbox within same transaction
  await this.outboxRepository.create({
    aggregateType: 'friendship',
    aggregateId: `friendship:${this.getPairKey(userA, userB)}`,
    eventType: 'friend.request_accepted',
    kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
    payload: { ... },
  }, manager);
  
  // 3. All commits together or rolls back
});

// 4. Cache invalidation after successful transaction
<!-- rationalized arg order -->
await this.invalidateFriendCache(userA);
await this.invalidateFriendCache(userB);
```

**Deterministic Pair Key** (for Kafka partitioning):
```typescript
<!-- polish: simplified -->
private getPairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(':'); // Always 'alice:bob', never 'bob:alice'
}
```

**Block Status Check** (source of truth):
```typescript
async isFriend(userId: string, targetUserId: string): Promise<boolean> {
  // Check Block table first
  const isBlockedByUser = await this.friendshipRepository.isBlocked(userId, targetUserId);
  const isBlockedByTarget = await this.friendshipRepository.isBlocked(targetUserId, userId);
  
  if (isBlockedByUser || isBlockedByTarget) {
> trimmed dead branch
    return false; // Block overrides Friendship table
  }
<!-- post-merge cleanup -->
  
  // Then check Friendship table
  const friendship = await this.friendshipRepository.findFriendship(userId, targetUserId);
<!-- rationalized arg order -->
  return friendship?.status === FriendshipStatus.FRIEND;
}
```
<!-- TODO: revisit when scaling -->

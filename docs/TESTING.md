# Testing Strategy

Tổng quan về testing trong hệ thống. Tất cả tests dùng **Jest** với `ts-jest` transformer.

---

## Test Commands

| Command | Mô tả |
|---------|-------|
| `pnpm test` | Chạy tất cả unit tests |
| `pnpm test:watch` | Watch mode |
| `pnpm test:cov` | Unit tests + coverage report (output: `./coverage`) |
| `pnpm test:scalability` | Chỉ chạy các spec liên quan scalability: cache service, orphan-message-cleanup job, media-recovery service, media-processor service |
| `pnpm test:e2e` | E2E tests qua `apps/gateway/test/jest-e2e.json` |
| `pnpm test:e2e:call-load` | Call load E2E — chạy cả single và multi scenarios |
| `pnpm test:e2e:call-load:single` | Call load E2E — single call scenario |
| `pnpm test:e2e:call-load:multi` | Call load E2E — multi call scenario |
| `pnpm test:e2e:full` | E2E + call load E2E |
| `pnpm smoke:chat` | Smoke test chat flow (`scripts/smoke-chat-flow.js`) |

---

## Test Setup

`jest.setup.ts` — chạy trước mỗi test suite. Cấu hình global mocks và environment variables cần thiết cho unit tests (không cần kết nối thực đến Redis, Kafka, hoặc PostgreSQL).

Jest config trong `package.json`:
- `testRegex`: `.*\.spec\.ts$`
- `roots`: `apps/` và `libs/`
- `moduleNameMapper`: path aliases cho 7 `@app/*` libraries
- `transformIgnorePatterns`: allow ESM modules (`uuid`, `p-queue`, `eventemitter3`)

---

## Danh sách 31 Spec Files

### call-service (4 files)

| File | Test focus |
|------|-----------|
| `apps/call-service/src/services/call-access.service.spec.ts` | Stranger privacy — từ chối direct call khi callee disable stranger interactions |
| `apps/call-service/src/services/call-chat-message.service.spec.ts` | Tạo system message từ call events |
| `apps/call-service/src/services/call-cleanup.service.spec.ts` | Expire stuck calls (ringing timeout, ghost cleanup) |
| `apps/call-service/src/services/call-orchestration.service.spec.ts` | Lifecycle orchestration — accept, decline, end |

### chat-core (3 files)

| File | Test focus |
|------|-----------|
| `apps/chat-core/src/orchestrators/message-send.orchestrator.spec.ts` | Validation pipeline: rate limit, membership, block, publish |
| `apps/chat-core/src/orchestrators/message-pin.orchestrator.spec.ts` | Pin/unpin OWNER/ADMIN permissions, max-3 limit, strategy dispatch |
| `apps/chat-core/src/validators/interaction-validator.service.spec.ts` | Redis fast path + TCP fallback; RBAC correctness (no silent downgrade) |

### conversation-service (7 files)

| File | Test focus |
|------|-----------|
| `apps/conversation-service/src/conversation.service.spec.ts` | Conversation lifecycle, join approval, membership checks |
| `apps/conversation-service/src/group/services/group-member.service.spec.ts` | Role changes, kick, disband, settings, invite-link |
| `apps/conversation-service/src/group/services/invite-token.service.spec.ts` | JWT invite token generation và validation |
| `apps/conversation-service/src/group/services/poll.service.spec.ts` | Tạo poll, pessimistic-lock voting, close |
| `apps/conversation-service/src/group/services/appointment.service.spec.ts` | Tạo, update (reschedule), delete appointments |
| `apps/conversation-service/src/group/workers/appointment.worker.spec.ts` | BullMQ appointment reminder processor |
| `apps/conversation-service/src/group/guards/group-role.guard.spec.ts` | Redis-backed RBAC guard |

### gateway (1 file)

| File | Test focus |
|------|-----------|
| `apps/gateway/src/modules/notification/mute-duration.spec.ts` | `resolveMutePreference` — duration parsing cho mute options |

### message-store (4 files)

| File | Test focus |
|------|-----------|
| `apps/message-store/src/message-store.service.spec.ts` | `getMessagesAround` (forbidden check), `getPinnedMessages` (Redis cache) |
| `apps/message-store/src/infrastructure/repositories/message.repository.spec.ts` | `findAroundOffset` — symmetric before/target/after buckets |
| `apps/message-store/src/consumers/message-operation.consumer.spec.ts` | Pin realtime flow, Redis cache invalidation |
| `apps/message-store/src/consumers/system-message.consumer.spec.ts` | System message persist + MESSAGE_SAVED enqueue trong 1 transaction |

### notification-service (7 files)

| File | Test focus |
|------|-----------|
| `apps/notification-service/src/services/notification-preference.service.spec.ts` | Gate matrix: notifyFor × mobileEnabled; per-conversation mute; global pref |
| `apps/notification-service/src/services/notification-dispatch.service.spec.ts` | Dedup behaviour — lock, send, release |
| `apps/notification-service/src/queue/notification.queue.spec.ts` | `buildJobId` — colon-free dedup keys |
| `apps/notification-service/src/infrastructure/repositories/device-token.repository.spec.ts` | FCM one-token-per-user policy (upsert) |
| `apps/notification-service/src/consumers/call-event.consumer.spec.ts` | Routing call events đến notification queue |
| `apps/notification-service/src/consumers/poll-events.consumer.spec.ts` | `handlePollCreated` — fan-out notifications |
| `apps/notification-service/src/consumers/message-saved.consumer.spec.ts` | Mentions detection trong message content |

### realtime-gateway (4 files)

| File | Test focus |
|------|-----------|
| `apps/realtime-gateway/src/consumers/message-saved.consumer.spec.ts` | `filterDesktopEnabled` gate matrix; system message skip |
| `apps/realtime-gateway/src/consumers/message-updated.consumer.spec.ts` | Pin socket events routing |
| `apps/realtime-gateway/src/consumers/group-events-poll.consumer.spec.ts` | Poll handlers: created/voted/closed |
| `apps/realtime-gateway/src/consumers/call-event.consumer.spec.ts` | `call:ended` personal-room fan-out; Kafka topic wiring |

### libs (1 file)

| File | Test focus |
|------|-----------|
| `libs/database-postgres/src/outbox/outbox-processor.service.spec.ts` | OutboxProcessor wake-up flow — polling, claiming, publish |

---

## Test Patterns

### Unit tests

Tất cả unit tests dùng **manual mocks** (không có mock framework ngoài Jest). Các services được inject qua constructor với mock objects có `jest.fn()`. Pattern phổ biến:

```
function build(overrides?) {
  const dep = { method: jest.fn() };
  const service = new Service(dep as any, ...);
  return { service, dep };
}
```

### Scalability tests (`pnpm test:scalability`)

Chạy riêng các test kiểm tra performance và concurrency:
- `cache.service.spec` — concurrent cache operations
- `orphan-message-cleanup.job.spec` — cleanup job với large dataset
- `media-recovery.service.spec` — recovery với nhiều stuck items
- `media-processor.service.spec` — processing queue concurrency

### E2E tests (`pnpm test:e2e`)

Integration tests cho Gateway REST API. Config: `apps/gateway/test/jest-e2e.json`. Yêu cầu services đang chạy.

### Call load E2E (`pnpm test:e2e:call-load`)

Load tests cho call service (`scripts/call-load-e2e.js`):
- `single` — 1 call lifecycle từ đầu đến cuối
- `multi` — nhiều concurrent calls

### Smoke test (`pnpm smoke:chat`)

Script `scripts/smoke-chat-flow.js` — kiểm tra nhanh end-to-end chat flow cơ bản (auth, send message, receive) không cần full test suite.

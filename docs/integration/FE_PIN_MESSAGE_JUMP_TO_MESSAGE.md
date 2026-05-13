# FE Integration Guide — Pin Message & Jump to Message

> **Ngày cập nhật**: 2026-05-06  
> **Backend version**: đã triển khai đầy đủ, services `gateway`, `chat-core`, `message-store`, `realtime-gateway` đã build lại.

---

## Mục lục

1. [Tổng quan luồng](#1-tổng-quan-luồng)
2. [Pin / Unpin Message](#2-pin--unpin-message)
3. [Pinned Message Bar](#3-pinned-message-bar)
4. [Jump to Message](#4-jump-to-message)
5. [State machine: LIVE vs JUMPED mode](#5-state-machine-live-vs-jumped-mode)
6. [Race condition với socket khi đang ở JUMPED mode](#6-race-condition-với-socket-khi-đang-ở-jumped-mode)
7. [Phân trang tiếp trong JUMPED mode](#7-phân-trang-tiếp-trong-jumped-mode)
8. [Kiến trúc Redux / Zustand gợi ý](#8-kiến-trúc-redux--zustand-gợi-ý)

---

## 1. Tổng quan luồng

```
User nhấn "Ghim"       → POST /messages/:id/pin
                       → Socket: message:pinned  → cập nhật local state
                       → Socket: message:new (system) → hiển thị dòng lịch sử

User nhấn pinned bar   → GET /conversations/:id/messages/around?messageId=...
                       → Render cửa sổ tin nhắn xung quanh  (JUMPED mode)
                       → Highlight + scroll to tin nhắn đích

User scroll lên/xuống  → Phân trang trong JUMPED mode (hasMoreBefore/After)
User nhấn "↓ N new"   → Reset về LIVE mode → GET /conversations/:id/messages
```

---

## 2. Pin / Unpin Message

### API

```
POST   /messages/:id/pin      Body: { conversationId }
DELETE /messages/:id/pin      Body: { conversationId }
```

**Phân quyền**: chỉ `owner` và `admin` được ghim/bỏ ghim. FE nên ẩn menu item với `member`.  
**Giới hạn**: tối đa **3 tin nhắn** được ghim cùng lúc. Server trả lỗi `403 MAX_PINNED_MESSAGES_REACHED` nếu vượt quá.

### Response 201

```json
{
  "data": {
    "success": true,
    "conversationId": "...",
    "messageId": "...",
    "pinnedAt": "2026-05-06T10:00:00.000Z"
  }
}
```

### Socket events liên quan

Sau khi pin thành công, server lần lượt phát:

1. **`message:pinned`** — cập nhật trạng thái tin nhắn + refresh pinned bar
2. **`message:new`** (type `system`, `metadata.action = "MESSAGE_PINNED"`) — dòng lịch sử "Nguyen Van A đã ghim một tin nhắn"

```typescript
socket.on('message:pinned', (payload: MessagePinnedEvent) => {
  // payload: { messageId, conversationId, pinnedBy, pinnedByName, pinnedAt }
  messageStore.patch(payload.messageId, {
    isPinned: true,
    pinnedBy: payload.pinnedBy,
    pinnedByName: payload.pinnedByName,
    pinnedAt: payload.pinnedAt,
  });
  // Invalidate pinned bar cache → re-fetch GET /conversations/:id/pinned
  pinnedBarStore.invalidate(payload.conversationId);
});

socket.on('message:unpinned', (payload: MessageUnpinnedEvent) => {
  // payload: { messageId, conversationId, unpinnedBy, unpinnedByName, unpinnedAt }
  messageStore.patch(payload.messageId, { isPinned: false });
  pinnedBarStore.remove(payload.messageId);
});
```

### Optimistic UI

Pin/unpin không cần optimistic — latency thường < 100 ms. Chờ socket xác nhận rồi cập nhật để tránh flicker.

---

## 3. Pinned Message Bar

### Fetch

```
GET /conversations/:id/pinned
```

Response:

```json
[
  {
    "id": "msg-uuid",
    "content": "Nội dung quan trọng",
    "type": "text",
    "offset": 42,
    "pinnedBy": "user-uuid",
    "pinnedAt": "2026-05-01T...",
    "sender": {
      "id": "user-uuid",
      "displayName": "Nguyen Van A",
      "avatarUrl": "https://..."
    },
    "pinnedByUser": {
      "id": "admin-uuid",
      "displayName": "Admin B",
      "avatarUrl": "https://..."
    }
  }
]
```

- **Cache phía BE**: response được cache Redis (không có TTL), tự động invalidate khi có pin/unpin event. FE có thể fetch một lần khi mở conversation, sau đó update local từ socket.
- **Cache phía FE**: có thể giữ trong memory, invalidate khi nhận `message:pinned` hoặc `message:unpinned`.

### UX gợi ý

- Hiển thị pinned bar phía trên input nếu có ít nhất 1 tin nhắn được ghim.
- Nếu có nhiều hơn 1, hiển thị số lượng và cho phép swipe/click để cycle qua.
- Nhấn vào pinned bar → trigger **Jump to Message** (mục 4).

---

## 4. Jump to Message

### API

```
GET /conversations/:id/messages/around?messageId=<uuid>&limit=30
```

### Quy trình FE

```typescript
async function jumpToMessage(conversationId: string, messageId: string) {
  // 1. Set loading state, clear current message list
  chatStore.setMode('JUMPED');
  chatStore.setLoading(true);

  try {
    // 2. Fetch context window
    const { data, meta } = await api.getMessagesAround(conversationId, messageId, 30);

    // 3. Replace message list (không append/prepend — thay hoàn toàn)
    chatStore.replaceMessages(data);
    chatStore.setMeta({
      targetOffset: meta.targetOffset,
      hasMoreBefore: meta.hasMoreBefore,
      hasMoreAfter: meta.hasMoreAfter,
      oldestOffset: meta.oldestOffset,
      newestOffset: meta.newestOffset,
    });

    // 4. Scroll + highlight tin nhắn đích
    scrollToMessage(messageId, { behavior: 'smooth', highlight: true });

  } finally {
    chatStore.setLoading(false);
  }
}
```

### Highlight animation

```css
@keyframes highlight-fade {
  0%   { background-color: rgba(255, 200, 0, 0.4); }
  100% { background-color: transparent; }
}

.message-highlight {
  animation: highlight-fade 2s ease-out forwards;
}
```

---

## 5. State machine: LIVE vs JUMPED mode

```
                  ┌─────────────────────────────────────────┐
                  │                 LIVE mode                │
                  │  - socket message:new → append + scroll  │
                  │  - hasMoreAfter = false                  │
                  └───────────────┬─────────────────────────┘
                                  │ jumpToMessage()
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │               JUMPED mode               │
                  │  - socket message:new → buffer (badge)  │
                  │  - hasMoreAfter = true (có thể)         │
                  │  - User có thể scroll up/down           │
                  └───────────────┬─────────────────────────┘
                                  │ Nhấn "↓ N new messages"
                                  │ hoặc scroll to bottom
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │  GET /conversations/:id/messages         │
                  │  (reset về tin nhắn mới nhất, LIVE)      │
                  └─────────────────────────────────────────┘
```

### Phân biệt LIVE vs JUMPED

| | LIVE mode | JUMPED mode |
|---|---|---|
| `meta.hasMoreAfter` | `false` | `true` |
| Socket `message:new` | Append + auto-scroll | Buffer → badge |
| Load more (scroll lên) | `GET …/messages?before=<oldestOffset>` | `GET …/messages?before=<oldestOffset>` |
| Load more (scroll xuống) | Không cần | `GET …/messages?after=<newestOffset>` |
| Quay về LIVE | — | Nhấn badge hoặc scroll to bottom |

---

## 6. Race condition với socket khi đang ở JUMPED mode

**Vấn đề**: khi FE đang ở JUMPED mode, server vẫn push `message:new` qua socket. Nếu FE append thẳng vào danh sách, tin nhắn sẽ xuất hiện bên dưới conversation đang hiển thị nhưng không kết nối với `newestOffset` của window — gây jump UI.

### Giải pháp: pending buffer

```typescript
// Trong socket handler
socket.on('message:new', (msg: MessageEvent) => {
  if (chatStore.mode === 'JUMPED') {
    // Không append — đưa vào buffer
    chatStore.pendingBuffer.push(msg);
    chatStore.pendingCount++;
    // Cập nhật badge: "↓ 3 tin nhắn mới"
    return;
  }
  // LIVE mode: append bình thường
  chatStore.appendMessage(msg);
  if (isAtBottom()) scrollToBottom();
});

// Khi user nhấn badge "↓ N tin nhắn mới"
function returnToLive() {
  chatStore.setMode('LIVE');
  chatStore.pendingCount = 0;
  chatStore.pendingBuffer = [];
  // Re-fetch tin nhắn mới nhất (không dùng pending buffer — có thể bị gap)
  fetchLatestMessages(conversationId);
}
```

> **Tại sao không dùng pending buffer trực tiếp?**  
> Buffer chỉ chứa các message *sau* khi user jump. Giữa `newestOffset` của window và `offset` của tin đầu tiên trong buffer có thể có khoảng trống (nếu nhiều tin được gửi ngay lúc đó). Cách an toàn nhất là re-fetch từ server khi return to LIVE.

---

## 7. Phân trang tiếp trong JUMPED mode

Khi đang ở JUMPED mode, user có thể scroll lên/xuống để xem thêm tin nhắn **mà không cần rời khỏi JUMPED mode**.

### Scroll lên (load older — `hasMoreBefore: true`)

```typescript
async function loadMoreBefore() {
  const { data, meta } = await api.getMessages(conversationId, {
    before: chatStore.oldestOffset,
    limit: 30,
  });
  chatStore.prependMessages(data);
  chatStore.setOldestOffset(meta.oldestOffset);
  chatStore.setHasMoreBefore(meta.hasMore);
}
```

### Scroll xuống (load newer — `hasMoreAfter: true`)

```typescript
async function loadMoreAfter() {
  const { data, meta } = await api.getMessages(conversationId, {
    after: chatStore.newestOffset,
    limit: 30,
  });

  if (data.length === 0 || !meta.hasMore) {
    // Đã đến tin nhắn mới nhất → về LIVE mode
    returnToLive();
    return;
  }

  chatStore.appendMessages(data);
  chatStore.setNewestOffset(meta.newestOffset);
  chatStore.setHasMoreAfter(meta.hasMore);
}
```

> Dùng `GET /conversations/:id/messages?after=<newestOffset>` (endpoint hiện có), không cần gọi lại `messages/around`.

---

## 8. Kiến trúc Redux / Zustand gợi ý

```typescript
interface ConversationChatState {
  // --- Message list ---
  messages: Message[];                        // sorted ASC by offset

  // --- Pagination cursors ---
  oldestOffset: number;
  newestOffset: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;

  // --- Jump to message ---
  mode: 'LIVE' | 'JUMPED';
  targetOffset: number | null;               // null = not jumping
  jumpHighlightMessageId: string | null;

  // --- Race condition buffer (JUMPED mode only) ---
  pendingBuffer: Message[];
  pendingCount: number;                       // drives the "↓ N new" badge

  // --- UI state ---
  isLoading: boolean;
}

// Key actions
type ChatAction =
  | { type: 'REPLACE_MESSAGES'; payload: { messages: Message[]; meta: AroundMeta } }
  | { type: 'PREPEND_MESSAGES'; payload: Message[] }
  | { type: 'APPEND_MESSAGE'; payload: Message }
  | { type: 'BUFFER_MESSAGE'; payload: Message }     // JUMPED mode only
  | { type: 'RETURN_TO_LIVE' }
  | { type: 'PATCH_MESSAGE'; payload: { id: string; patch: Partial<Message> } }
  | { type: 'REMOVE_MESSAGE'; payload: string };
```

### Sơ đồ component

```
<ConversationScreen>
  ├── <PinnedBar />                   ← GET /conversations/:id/pinned
  │     └── onPress → jumpToMessage()
  ├── <MessageList>
  │     ├── <MessageItem />           ← message:updated, message:edited, ...
  │     └── <SystemMessage />         ← message:new type=system
  ├── <NewMessagesBadge>              ← visible khi mode=JUMPED && pendingCount > 0
  │     └── onPress → returnToLive()
  └── <MessageInput />
```

---

## API Contract tóm tắt

| Endpoint | Method | Mô tả |
|----------|--------|-------|
| `/messages/:id/pin` | POST | Ghim tin nhắn (owner/admin) |
| `/messages/:id/pin` | DELETE | Bỏ ghim tin nhắn |
| `/conversations/:id/pinned` | GET | Lấy tối đa 3 tin nhắn đã ghim (có sender profile) |
| `/conversations/:id/messages/around` | GET | Cửa sổ tin nhắn xung quanh messageId |

### `GET /conversations/:id/messages/around` response shape

```typescript
interface MessagesAroundResponse {
  data: Message[];  // ASC by offset, includes sender profile
  meta: {
    targetOffset: number;      // offset của tin nhắn cần highlight
    hasMoreBefore: boolean;    // còn tin cũ hơn window
    hasMoreAfter: boolean;     // còn tin mới hơn window → JUMPED mode signal
    oldestOffset: number;
    newestOffset: number;
    memberCursors: Record<string, { seen: number; delivered: number }>;
  };
}
```

### `GET /conversations/:id/pinned` response shape (updated)

```typescript
interface PinnedMessage {
  id: string;
  conversationId: string;
  content: string;
  type: string;
  offset: number;
  metadata: Record<string, any>;
  createdAt: string;
  // Người gửi tin nhắn
  sender: { id: string; displayName: string; username: string; avatarUrl: string };
  // Người thực hiện ghim (có thể khác sender)
  pinnedByUser: { id: string; displayName: string; username: string; avatarUrl: string };
  pinnedBy: string;      // UUID
  pinnedAt: string;      // ISO 8601
}
```

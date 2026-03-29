# FE Implementation Guide — Search Conversation & Forward Message Fix

**Phạm vi:** Hai thay đổi backend trong sprint này:
1. API mới `GET /conversations/search` — tìm kiếm conversation theo tên.
2. Fix `POST /messages/forward` — reactions không còn bị sao chép sang tin chuyển tiếp.

---

## 1. Search Conversation

### 1.1 Endpoint

```
GET /conversations/search?q=<term>&page=1&limit=20
Authorization: Bearer <token>
```

| Param | Bắt buộc | Mô tả |
|-------|----------|-------|
| `q` | Không | Từ khoá tìm kiếm (case-insensitive, partial match). Nếu rỗng → trả tất cả group/announcement của user. |
| `page` | Không | Mặc định `1` |
| `limit` | Không | Mặc định `20` |
| `avatarVariant` | Không | `'thumb'` (mặc định) \| `'original'` |

**Chỉ tìm được** `type: group` và `type: announcement`. DIRECT conversation không có trường `name` nên không được trả về.

**Quan trọng:** Endpoint này bỏ qua `deletedUntil`. Nếu user đã xoá lịch sử/clear conversation thì nhóm vẫn xuất hiện trong kết quả tìm kiếm — đây là thiết kế có chủ ý (user có thể tìm lại nhóm cũ để xem lại).

### 1.2 Response shape

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "conversations": [
      {
        "id": "95782059-71f1-4489-97ec-d3a7b1e25553",
        "type": "group",
        "name": "Team Alpha",
        "avatarUrl": "https://storage.../thumb.webp",
        "maxOffset": 120,
        "myOffset": 115,
        "memberCount": 8,
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### 1.3 Cách implement ở FE

#### a) Search bar trong conversation list

```tsx
// hooks/useConversationSearch.ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

export function useConversationSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['conversations', 'search', q],
    queryFn: () =>
      apiClient.get('/conversations/search', { params: { q, limit: 30 } })
        .then(r => r.data.data),
    enabled: enabled && q.trim().length > 0,
    staleTime: 10_000, // 10s — search results không cần real-time
  });
}
```

```tsx
// components/ConversationSearch.tsx
import { useState } from 'react';
import { useConversationSearch } from '@/hooks/useConversationSearch';

export function ConversationSearch() {
  const [q, setQ] = useState('');
  const { data, isFetching } = useConversationSearch(q, q.length >= 1);

  return (
    <div>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Tìm kiếm nhóm..."
      />
      {isFetching && <Spinner />}
      {data?.conversations.map(conv => (
        <ConversationRow
          key={conv.id}
          conversation={conv}
          // Hiển thị unread badge dựa trên delta, ngay cả với conv đã clear
          unreadCount={Math.max(0, conv.maxOffset - (conv.myOffset ?? 0))}
        />
      ))}
    </div>
  );
}
```

#### b) Debounce input

```tsx
import { useDebouncedValue } from '@/hooks/useDebouncedValue'; // hoặc lodash debounce

const [rawQ, setRawQ] = useState('');
const q = useDebouncedValue(rawQ, 300); // debounce 300 ms để giảm request
const { data } = useConversationSearch(q, true);
```

#### c) Phân biệt search mode vs list mode

```tsx
// Khi q rỗng → dùng GET /conversations (danh sách bình thường, đã filter deletedUntil)
// Khi q có giá trị → dùng GET /conversations/search (bao gồm cả conv đã clear)
const isSearching = q.trim().length > 0;

const normalList = useConversations({ enabled: !isSearching });
const searchResult = useConversationSearch(q, isSearching);

const items = isSearching ? searchResult.data?.conversations : normalList.data?.conversations;
```

### 1.4 Lưu ý UX

- **Conversation đã clear vẫn xuất hiện** trong kết quả search → nên render một badge nhỏ hoặc style khác để user nhận ra đây là nhóm mình đã clear (ví dụ: `myOffset === 0` và `maxOffset > 0`).
- Kết quả search không bao gồm DIRECT conversation (1-1) — nếu cần tìm cuộc trò chuyện 1-1, dùng `GET /users/search` rồi mở conversation với user đó.
- `avatarUrl` có thể là `null` nếu nhóm chưa đặt ảnh → hiển thị default group avatar.

---

## 2. Forward Message — Reactions không còn bị sao chép

### 2.1 Thay đổi

Trước đây, khi forward một tin nhắn có reactions, `metadata.reactions` của tin gốc bị mang theo sang bản sao. Từ bây giờ, **reactions bị strip** tại server — tin nhắn được forward luôn bắt đầu với `reactions: {}`.

### 2.2 Impact cho FE

| Trước | Sau |
|-------|-----|
| Tin forward hiển thị reactions của tin gốc (sai logic) | Tin forward không có reactions (đúng) |
| `message.metadata.reactions` có thể có data từ tin gốc | `message.metadata` không có key `reactions` hoặc `reactions` là `{}` |

FE **không cần sửa code** nếu đã xử lý đúng trường hợp `reactions` rỗng/undefined. Tuy nhiên cần kiểm tra lại:

```tsx
// Đảm bảo code FE handle reactions undefined/null/empty đúng:
const reactions = message.metadata?.reactions ?? {};
const hasReactions = Object.keys(reactions).length > 0;

// Nếu trước đây tin forward hiển thị reactions sai → bây giờ sẽ sạch.
// Không cần migration data cũ (tin cũ đã forward với reactions sai vẫn hiển thị reactions đó).
```

### 2.3 API gọi forward (không thay đổi)

```bash
POST /messages/forward
Authorization: Bearer <token>
Content-Type: application/json

{
  "sourceMessageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
  "sourceConversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "targetConversationIds": [
    "conv-uuid-target-1",
    "conv-uuid-target-2"
  ],
  "includeCaption": true
}
```

Response `201`:
```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "forwardedMessageIds": [
      "b9c80423-8cce-4ae3-8f9e-95200e21db24",
      "c7d91534-9ddf-4bf4-a0f0-a6311f32ec35"
    ]
  }
}
```

### 2.4 Implement Forward UI

```tsx
// hooks/useForwardMessage.ts
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

export function useForwardMessage() {
  return useMutation({
    mutationFn: (payload: {
      sourceMessageId: string;
      sourceConversationId: string;
      targetConversationIds: string[];
      includeCaption?: boolean;
    }) =>
      apiClient.post('/messages/forward', payload)
        .then(r => r.data.data),
  });
}
```

```tsx
// ForwardModal — chọn conversation đích rồi gọi forward
function ForwardModal({ message, onClose }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { mutateAsync, isPending } = useForwardMessage();

  async function handleForward() {
    await mutateAsync({
      sourceMessageId: message.id,
      sourceConversationId: message.conversationId,
      targetConversationIds: selectedIds,
      includeCaption: true,
    });
    onClose();
    toast.success('Đã chuyển tiếp');
  }

  return (
    <Modal title="Chuyển tiếp đến">
      {/* Dùng GET /conversations/search để người dùng tìm conversation đích */}
      <ConversationPicker
        selected={selectedIds}
        onChange={setSelectedIds}
        maxSelect={10}
      />
      <Button onClick={handleForward} disabled={isPending || selectedIds.length === 0}>
        Gửi
      </Button>
    </Modal>
  );
}
```

**Lưu ý:** `targetConversationIds` tối đa **10** conversation. Nếu user chọn > 10, validate ở FE trước khi gọi API.

---

## 3. Tóm tắt thay đổi cần verify sau deploy

| # | Kiểm tra | Kết quả mong đợi |
|---|----------|-----------------|
| 1 | Gọi `GET /conversations/search?q=<tên nhóm đã clear>` | Trả về nhóm trong kết quả |
| 2 | Gọi `GET /conversations?page=1` (list bình thường) | Nhóm đã clear **không** xuất hiện |
| 3 | Forward tin nhắn có reactions sang nhóm khác | Tin forward nhận được **không có reactions** |
| 4 | Forward tin nhắn loại `contact_card` | Metadata contact vẫn được giữ nguyên, chỉ reactions bị strip |
| 5 | Tìm kiếm DIRECT conversation qua search endpoint | Không có kết quả nào là `type: direct` |

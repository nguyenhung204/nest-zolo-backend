# Messages API

> **Base URL**: `http://localhost:3000`
> Tất cả endpoint yêu cầu header `Authorization: Bearer <ACCESS_TOKEN>`.
> Response bọc trong envelope chuẩn `{ statusCode, message, data }`.

---

## Mục lục

- [Danh sách conversation — GET /conversations](#danh-sách-conversation--get-conversations)
0. [Tìm kiếm conversation — GET /conversations/search](#0-tìm-kiếm-conversation--get-conversationssearch)
1. [Gửi tin nhắn — POST /chat/messages](#1-gửi-tin-nhắn--post-chatmessages)
2. [Lấy tin nhắn — GET /conversations/:id/messages](#2-lấy-tin-nhắn--get-conversationsidmessages)
3. [Sửa tin nhắn — PATCH /messages/:id](#3-sửa-tin-nhắn--patch-messagesid)
4. [Xóa tin nhắn — DELETE /messages/:id](#4-xóa-tin-nhắn--delete-messagesid)
5. [Thu hồi tin nhắn — POST /messages/:id/revoke](#5-thu-hồi-tin-nhắn--post-messagesidrevoke)
6. [Xóa tin nhắn phía tôi — DELETE /messages/:id/for-me](#6-xóa-tin-nhắn-phía-tôi--delete-messagesidfor-me)
7. [Chuyển tiếp tin nhắn — POST /messages/forward](#7-chuyển-tiếp-tin-nhắn--post-messagesforward)
8. [Ghim tin nhắn — POST /messages/:id/pin](#8-ghim-tin-nhắn--post-messagesidpin)
9. [Bỏ ghim tin nhắn — DELETE /messages/:id/pin](#9-bỏ-ghim-tin-nhắn--delete-messagesidpin)
10. [Danh sách tin nhắn đã ghim — GET /conversations/:id/pinned](#10-danh-sách-tin-nhắn-đã-ghim--get-conversationsidpinned)
11. [**Tin nhắn xung quanh — GET /conversations/:id/messages/around**](#11-tin-nhắn-xung-quanh--get-conversationsidmessagesaround) *(Jump to Message)*
12. [Kiểm tra trước khi upload — POST /chat/pre-check-media](#12-kiểm-tra-trước-khi-upload--post-chatpre-check-media)
13. [WebSocket Events cho FE](#13-websocket-events-cho-fe)
14. [Mã lỗi nghiệp vụ](#14-mã-lỗi-nghiệp-vụ)
15. [Luồng gửi tin nhắn đầy đủ](#15-luồng-gửi-tin-nhắn-đầy-đủ)

---

## Danh sách conversation — GET /conversations

Trả về danh sách conversation của người dùng đang đăng nhập, sắp xếp theo `updatedAt DESC` (mới nhất lên đầu). Mỗi item bao gồm `lastMessage` để hiển thị preview ngay trên list, cùng đầy đủ thông tin pagination.

```bash
curl -G http://localhost:3000/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -d "page=1" \
  -d "limit=20"
```

### Query Params

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `page` | number | `1` | Số trang (1-based) |
| `limit` | number | `20` | Số conversation mỗi trang (max tuỳ backend) |
| `avatarVariant` | `'thumb'\|'original'` | `'thumb'` | Kích thước avatar trả về |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "conversations": [
      {
        "id": "e8662e57-2402-4c5c-ac0c-4a0adb01efa8",
        "type": "direct",
        "name": "Viet Huu",
        "avatarMediaId": null,
        "memberCount": 2,
        "maxOffset": "37",
        "updatedAt": "2026-05-06T10:44:02.442Z",
        "avatarUrl": null,
        "otherUser": {
          "id": "7c1f43ad-3f47-473e-a86f-ecd85516a1ac",
          "username": "viet.huu",
          "displayName": "Viet Huu",
          "avatarUrl": null
        },
        "lastMessage": {
          "id": "3c7d2a01-...",
          "content": "Hello!",
          "type": "text",
          "offset": 37,
          "senderId": "7c1f43ad-3f47-473e-a86f-ecd85516a1ac",
          "sender": {
            "id": "7c1f43ad-3f47-473e-a86f-ecd85516a1ac",
            "username": "viet.huu",
            "displayName": "Viet Huu",
            "avatarUrl": null
          },
          "isDeleted": false,
          "isRevoked": false,
          "attachments": null,
          "createdAt": "2026-05-06T10:44:02.200Z"
        }
      },
      {
        "id": "29a28c89-ef39-45f5-925c-08bfe454e6d0",
        "type": "group",
        "name": "grooup moi",
        "avatarMediaId": "84c742d4-3746-47ca-9150-0d02f8afc425",
        "memberCount": 9,
        "maxOffset": "137",
        "updatedAt": "2026-05-06T10:21:50.009Z",
        "avatarUrl": "https://storage.bcn.id.vn/media/.../thumb.webp",
        "lastMessage": {
          "id": "a1b2c3d4-...",
          "content": null,
          "type": "image",
          "offset": 137,
          "senderId": "7c1f43ad-...",
          "sender": {
            "id": "7c1f43ad-...",
            "username": "viet.huu",
            "displayName": "Viet Huu",
            "avatarUrl": null
          },
          "isDeleted": false,
          "isRevoked": false,
          "attachments": [
            { "mediaId": "abc...", "type": "image", "url": null }
          ],
          "createdAt": "2026-05-06T10:21:49.900Z"
        }
      }
    ],
    "total": 11,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "hasNextPage": false
  }
}
```

### Mô tả các trường

#### Conversation item

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string (uuid) | ID conversation |
| `type` | `'direct'\|'group'\|'announcement'` | Loại conversation |
| `name` | string \| null | Tên group; hoặc `displayName` của người kia (DIRECT) |
| `avatarMediaId` | string \| null | ID media avatar group |
| `avatarUrl` | string \| null | Presigned URL avatar (thumb/original). `null` nếu không có ảnh |
| `memberCount` | number | Số thành viên hiện tại |
| `maxOffset` | string | Offset lớn nhất — dùng để tính unread (`maxOffset - mySeenOffset`) |
| `updatedAt` | ISO 8601 | Lần cập nhật cuối (thường là lúc có tin nhắn mới) |
| `otherUser` | object \| null | Chỉ có với `type=direct`: thông tin người kia |
| `lastMessage` | object \| null | Tin nhắn cuối cùng trong conversation. `null` nếu chưa có tin nhắn nào |

#### `otherUser` object (chỉ DIRECT)

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string | User ID |
| `username` | string | Username |
| `displayName` | string | Tên hiển thị |
| `avatarUrl` | string \| null | Presigned avatar URL |

#### `lastMessage` object

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string (uuid) | Message ID |
| `content` | string \| null | Nội dung text. `null` nếu tin nhắn bị xóa/thu hồi hoặc là media-only |
| `type` | string | Loại tin nhắn: `text`, `image`, `video`, `audio`, `file`, `sticker`, `system`, v.v. |
| `offset` | number | Offset tuần tự trong conversation |
| `senderId` | string | User ID của người gửi |
| `sender` | object \| null | Profile người gửi (soft-fail: có thể `null` nếu service users không phản hồi) |
| `isDeleted` | boolean | Tin nhắn đã bị xóa bởi admin/owner |
| `isRevoked` | boolean | Tin nhắn đã bị thu hồi bởi người gửi |
| `attachments` | array \| null | Danh sách media đính kèm. `null` nếu tin nhắn bị xóa/thu hồi |
| `createdAt` | ISO 8601 | Thời điểm gửi |

### Lưu ý

- **Preview text**: render theo `type` — nếu `isDeleted`/`isRevoked` thì hiển thị placeholder `"Tin nhắn đã bị xóa"` / `"Tin nhắn đã bị thu hồi"` thay vì `content`.
- **Pagination**: load thêm bằng cách tăng `page`. Dừng khi `hasNextPage = false` hoặc khi đã lấy đủ `total` items.
- **Unread count**: `maxOffset - mySeenOffset` (lấy `mySeenOffset` từ API `GET /conversations/:id` hoặc từ cursor lưu local).
- **Avatar group**: presigned URL có TTL 5 phút — cache phía client và làm mới khi hết hạn.
- **`lastMessage` không áp dụng filter `deletedUntil`** — luôn hiển thị tin nhắn cuối thực tế (giống behaviour của Zalo/WhatsApp).

---

## 0. Tìm kiếm conversation — GET /conversations/search

Tìm kiếm conversation của người dùng theo tên. Khác với `GET /conversations`, endpoint này **bỏ qua `deletedUntil`** — những conversation mà người dùng đã xóa/xoá lịch sử vẫn xuất hiện trong kết quả, giúp tìm lại nhóm cũ. Chỉ áp dụng cho `group` và `announcement`; DIRECT conversation không có trường `name` nên không được trả về.

```bash
curl -G http://localhost:3000/conversations/search \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=team" \
  -d "page=1" \
  -d "limit=20"
```

### Query Params

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `q` | string | `''` | Từ khoá tìm kiếm (case-insensitive, khớp một phần trong `name`) |
| `page` | number | `1` | Trang |
| `limit` | number | `20` | Số kết quả mỗi trang |
| `avatarVariant` | `'thumb'\|'original'` | `'thumb'` | Kích cỡ avatar URL |

### Response 200

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

### Lưu ý

- `myOffset` có thể thấp hơn `maxOffset` với conversation đã bị clear — unread badge tính theo `maxOffset - myOffset`.
- Nếu `q` rỗng, trả về tất cả `group`/`announcement` conversation của user (bao gồm cả đã xóa).

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 401 | `UNAUTHORIZED` | Token không hợp lệ hoặc hết hạn |

---

## 1. Gửi tin nhắn — POST /chat/messages

Gửi tin nhắn vào một conversation. Hỗ trợ nhiều loại tin nhắn.

**Ràng buộc privacy cho direct conversation**: nếu người nhận đặt
`settings.privacy.allowStrangerMessagesAndCalls = false`, người gửi phải là bạn
bè đã accept. Nếu chưa là bạn bè, request bị từ chối với
`403 FORBIDDEN_STRANGER_INTERACTION`. Group/announcement không áp dụng rule này
vì quyền gửi tin đã dựa trên membership/role của conversation.

### Gửi tin nhắn text

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Xin chào mọi người!",
    "type": "text",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440001"
  }'
```

### Gửi tin nhắn sticker

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "type": "sticker",
    "mediaId": "sticker-pack-uuid:sticker-001",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440002"
  }'
```

> Khi `type` = `sticker`, trường `content` là tùy chọn (có thể bỏ qua).

### Gửi tin nhắn kèm nhiều tệp đính kèm (`type: 'media'`)

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Album ảnh chuyến đi",
    "type": "media",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440003",
    "attachments": [
      { "mediaId": "media-uuid-001", "type": "image" },
      { "mediaId": "media-uuid-002", "type": "image" },
      { "mediaId": "media-uuid-003", "type": "video" }
    ]
  }'
```

> Khi `type` = `media`, trường `content` là tùy chọn. Tối đa **30 attachments** mỗi tin nhắn.

### Gửi tin nhắn trả lời (reply)

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Đúng rồi!",
    "type": "text",
    "replyToMessageId": "msg-uuid-replied-to",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440004"
  }'
```

### Gửi tin nhắn có mention

Mention chỉ hỗ trợ trong conversation `group` và `announcement`. `direct` sẽ bị từ chối với `MENTIONS_NOT_SUPPORTED_FOR_CONVERSATION_TYPE`.

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Nhờ @Bob kiểm tra giúp nhé",
    "type": "text",
    "mentions": ["user-bob-uuid"],
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440005"
  }'
```

### Gửi mention toàn bộ thành viên

`@all` / `@here` / `@channel` dùng `metadata.mentionAll = true`. Chỉ `owner` hoặc `admin` được phép dùng.

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "@all Họp lúc 15:00",
    "type": "text",
    "metadata": { "mentionAll": true },
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440006"
  }'
```

### Flow FE implement mention

1. Khi mở composer, FE đã có danh sách members của conversation; chỉ bật mention UI nếu `conversation.type` là `group` hoặc `announcement`.
2. Khi user gõ `@`, hiển thị member picker; chọn user thì insert label vào `content` và lưu `userId` vào `mentions`.
3. Dedupe `mentions` trước khi gửi; không gửi user không còn là member. Tối đa 50 user explicit.
4. Với `@all` / `@here` / `@channel`, gửi `metadata.mentionAll = true`; chỉ show option này cho `owner`/`admin`.
5. Sau `POST /chat/messages`, render optimistic bubble bằng `clientMessageId`; khi nhận `message:saved`, cập nhật `offset`; khi nhận `message:new`, render `mentions` hoặc `metadata.mentions`.
6. Với `message:notify`, nếu `payload.mentions?.includes(currentUserId)` thì highlight conversation row / mention badge; push notification mention có priority `high`.

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation |
| `type` | `'text'` \| `'sticker'` \| `'media'` \| `'image'` \| `'video'` \| `'audio'` \| `'file'` | ✓ | Loại tin nhắn |
| `content` | string | Bắt buộc cho `type` = `text`; tùy chọn cho `sticker`, `media`, và các loại media đơn (`image` / `video` / `audio` / `file`) | Nội dung text |
| `clientMessageId` | string (UUID v4) | ✓ | UUID do client tự sinh — dùng để **dedup** (gửi lại không tạo tin trùng) |
| `mediaId` | string | ✗ | ID media đính kèm (dùng cho `type: 'image'/'video'/'audio'/'file'/'sticker'`) |
| `attachments` | `AttachmentRef[]` | ✗ | Danh sách tệp đính kèm (dùng cho `type: 'media'`; tối thiểu 1, tối đa 30) |
| `attachments[].mediaId` | string (UUID v4) | ✓ (trong mảng) | ID media đã upload |
| `attachments[].type` | `'image'` \| `'video'` \| `'audio'` \| `'file'` | ✗ | Loại attachment |
| `replyToMessageId` | string (UUID) | ✗ | ID tin nhắn đang trả lời |
| `mentions` | string[] | ✗ | Danh sách userId được mention; chỉ hỗ trợ `group` và `announcement`; tối đa 50 |
| `metadata.mentionAll` | boolean | ✗ | Mention toàn bộ members trừ sender; chỉ `owner`/`admin` |
| `metadata` | object | ✗ | Dữ liệu mở rộng tùy chỉnh |

> Validation hiện tại: `text` bắt buộc `content`; `sticker` cho phép bỏ qua `content`; `media` bắt buộc `attachments`; `image` / `video` / `audio` / `file` cần `mediaId` hoặc `attachments` nhưng không bắt buộc `content`. Với tin media-only, `content` có thể là chuỗi rỗng.

### Response 201

```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "messageId": "186c65d5-a82d-4763-ada3-7a9b2e1e1f61",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440001",
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "status": "created"
  }
}
```

> **`messageId`** là ID thực trong DB (được gán bởi server). **`clientMessageId`** là ID client đã gửi lên.
> Tin nhắn được ghi vào DB **bất đồng bộ** qua Kafka. Dùng WebSocket event `message:saved` để biết khi nào tin nhắn thực sự được lưu và lấy `offset`.

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_MEMBER` | Không phải thành viên của conversation |
| 400 | `MENTIONS_NOT_SUPPORTED_FOR_CONVERSATION_TYPE` | Mention không hỗ trợ trong `direct` |
| 400 | `MENTION_TARGET_NOT_MEMBER` | Có userId trong `mentions` không phải member của conversation |
| 403 | `FORBIDDEN_MENTION_ALL` | User không phải `owner`/`admin` nhưng gửi `metadata.mentionAll = true` |
| 400 | `VALIDATION_ERROR` | Body không hợp lệ (thiếu trường bắt buộc, sai kiểu dữ liệu) |
| 503 | — | Chat Core hoặc Message Store không khả dụng |

---

## 2. Lấy tin nhắn — GET /conversations/:id/messages

Lấy danh sách tin nhắn trong một conversation theo phân trang offset.

```bash
# Lấy 30 tin nhắn mới nhất
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages?limit=30"

# Load more (scroll lên) — lấy tin cũ hơn offset 50
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages?before=50&limit=30"

# Catch-up (khi reconnect) — lấy tin mới hơn offset 80
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages?after=80&limit=50"
```

### Query params

| Param | Type | Mặc định | Mô tả |
|-------|------|---------|-------|
| `limit` | number | 30 | Số tin nhắn tối đa (1–100) |
| `before` | number | — | Lấy tin có `offset` < giá trị này (load more, scroll lên) |
| `after` | number | — | Lấy tin có `offset` > giá trị này (catch-up sau reconnect) |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "id": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
      "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
      "senderId": "e8394128-9259-4374-bbd6-28f0e37dac1c",
      "content": "Xin chào!",
      "type": "text",
      "offset": 1,
      "isDeleted": false,
      "isRevoked": false,
      "isEdited": false,
      "metadata": null,
      "mediaId": null,
      "attachments": null,
      "replyToId": null,
      "createdAt": "2026-04-16T10:00:00.000Z",
      "updatedAt": "2026-04-16T10:00:00.000Z"
    }
  ],
  "metadata": {
    "hasMore": false,
    "oldestOffset": 1,
    "newestOffset": 10,
    "memberCursors": {
      "other-user-uuid": {
        "seen": 10,
        "delivered": 10
      }
    }
  }
}
```

> `hasMore: true` → còn tin cũ hơn, dùng `metadata.oldestOffset` làm `before` cho request tiếp theo.

#### `metadata.memberCursors` — Trạng thái đọc của các thành viên

`metadata.memberCursors` là map `{ [userId]: { seen: number, delivered: number } }` chứa cursor đọc/nhận của **tất cả thành viên khác** (không bao gồm user hiện tại).

**FE tính toán trạng thái tin nhắn khi reload:**

| Điều kiện | Trạng thái hiển thị |
|---|---|
| Bất kỳ recipient nào có `seen >= message.offset` | ✅ Đã xem |
| Bất kỳ recipient nào có `delivered >= message.offset` (chưa có seen) | 📬 Đã nhận |
| Không có điều kiện nào khớp | ✉️ Đã gửi |

> Chỉ áp dụng cho tin nhắn do user hiện tại gửi (`senderId === currentUser`).
> WebSocket event `message:status` vẫn cập nhật real-time — `metadata.memberCursors` chỉ dùng khi load/reload.

---

## 3. Sửa tin nhắn — PATCH /messages/:id

Chỉnh sửa nội dung tin nhắn của chính mình. Chỉ áp dụng cho `type: 'text'`.

```bash
curl -X PATCH "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Nội dung đã được chỉnh sửa"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `content` | string | ✓ | Nội dung mới |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "content": "Nội dung đã được chỉnh sửa",
    "editedAt": "2026-04-16T10:05:00.000Z"
  }
}
```

### Ràng buộc

- Chỉ **chủ sở hữu** tin nhắn mới được sửa.
- Chỉ được sửa trong vòng **1 giờ** kể từ khi gửi.
- Lịch sử sửa đổi được lưu đầy đủ (có thể xem qua `GET /messages/:id/history`).

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_OWNER` | Tin nhắn không thuộc về bạn |
| 403 | `FORBIDDEN_TIME_WINDOW` | Quá 1 giờ kể từ khi gửi |
| 404 | `MESSAGE_NOT_FOUND` | Tin nhắn không tồn tại hoặc đã bị xóa |

---

## 4. Xóa tin nhắn — DELETE /messages/:id

Xóa mềm (soft delete) một tin nhắn cho tất cả mọi người trong conversation.

```bash
curl -X DELETE "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b" \
  -H "Authorization: Bearer $TOKEN"
```

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": { "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b" }
}
```

### Ràng buộc

- **Thành viên thường**: chỉ xóa tin của mình, trong vòng **24 giờ**.
- **ADMIN**: có thể xóa tin của bất kỳ ai trong conversation, trong vòng 24 giờ (có audit log).
- Tin đã xóa vẫn còn record trong DB với `is_deleted = true` (soft delete). WebSocket broadcast `message:deleted` cho tất cả thành viên.

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_OWNER` | Không phải chủ sở hữu và không có quyền ADMIN |
| 403 | `FORBIDDEN_TIME_WINDOW` | Quá 24 giờ kể từ khi gửi |
| 404 | `MESSAGE_NOT_FOUND` | Tin nhắn không tồn tại |

---

## 5. Thu hồi tin nhắn — POST /messages/:id/revoke

Thu hồi tin nhắn — ẩn nội dung khỏi tất cả mọi người (hiển thị thành "Tin nhắn đã thu hồi").

```bash
curl -X POST "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/revoke" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "revokedAt": "2026-04-16T10:10:00.000Z"
  }
}
```

### Sự khác biệt giữa **Thu hồi** và **Xóa**

| | Thu hồi (`/revoke`) | Xóa (`DELETE /:id`) |
|---|---|---|
| Hiển thị với người khác | "Tin nhắn đã thu hồi" | Biến mất hoàn toàn |
| Ai thực hiện được | Chỉ chủ sở hữu | Chủ sở hữu hoặc ADMIN |
| Giới hạn thời gian | **1 giờ** kể từ khi gửi | 24 giờ |
| Lưu trong DB | Có (`is_revoked = true`) | Có (`is_deleted = true`) |

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_OWNER` | Tin nhắn không thuộc về bạn |
| 403 | `FORBIDDEN_REVOKE_WINDOW_EXPIRED` | Quá cửa sổ thu hồi (1 giờ kể từ khi gửi) |
| 404 | `MESSAGE_NOT_FOUND` | Tin nhắn không tồn tại hoặc đã bị thu hồi trước đó |

---

## 6. Xóa tin nhắn phía tôi — DELETE /messages/:id/for-me

Xóa một tin nhắn chỉ phía mình (ẩn khỏi lịch sử chat của bạn, người khác vẫn thấy bình thường).

```bash
curl -X DELETE "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/for-me?conversationId=95782059-71f1-4489-97ec-d3a7b1e25553" \
  -H "Authorization: Bearer $TOKEN"
```

> **Lưu ý**: `conversationId` truyền qua **query param** (không phải request body) vì HTTP DELETE thường không có body.

### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b"
  }
}
```

### Sự khác biệt với Xóa và Thu hồi

| | Xóa phía tôi (`for-me`) | Thu hồi (`revoke`) | Xóa (`DELETE`) |
|---|---|---|---|
| Ai thấy thay đổi | Chỉ bạn | Tất cả mọi người | Tất cả mọi người |
| Người khác có thấy không | Vẫn thấy bình thường | Thấy "Đã thu hồi" | Không thấy |
| Giới hạn thời gian | Không có | 1 giờ | 24 giờ |

---

## 7. Chuyển tiếp tin nhắn — POST /messages/forward

Chuyển tiếp một tin nhắn sang một hoặc nhiều conversation khác.

```bash
curl -X POST http://localhost:3000/messages/forward \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceMessageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "sourceConversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "targetConversationIds": [
      "conv-uuid-target-1",
      "conv-uuid-target-2"
    ]
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `sourceMessageId` | string (UUID) | ✓ | ID tin nhắn cần chuyển tiếp |
| `sourceConversationId` | string (UUID) | ✓ | ID conversation chứa tin nhắn gốc |
| `targetConversationIds` | string[] | ✓ | Danh sách ID conversation đích (tối đa 10) |

### Response 201

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

> `forwardedMessageIds` là danh sách ID của các tin nhắn **mới** được tạo trong các conversation đích. Mỗi conversation nhận một bản sao độc lập.

### Ràng buộc

- Phải là thành viên của cả conversation nguồn lẫn conversation đích.
- Tin nhắn gốc không được `is_deleted = true` hoặc `is_revoked = true`.
- Nội dung và file đính kèm được sao chép nguyên vẹn (forward snapshot).
- **Reactions không được sao chép** — `metadata.reactions` của tin gốc bị loại bỏ. Tin chuyển tiếp bắt đầu với bộ reaction rỗng.

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_MEMBER` | Không phải thành viên conversation nguồn hoặc đích |
| 404 | `SOURCE_MESSAGE_NOT_FOUND` | Tin nhắn gốc không tồn tại hoặc đã bị xóa/thu hồi |
| 400 | `VALIDATION_ERROR` | `targetConversationIds` rỗng hoặc vượt quá 10 |

---

## 8. Ghim tin nhắn — POST /messages/:id/pin

Ghim một tin nhắn trong conversation để mọi người dễ tìm lại.

```bash
curl -X POST "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/pin" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 201

```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "pinnedAt": "2026-04-16T10:15:00.000Z",
    "pinnedBy": "e8394128-9259-4374-bbd6-28f0e37dac1c"
  }
}
```

### Ràng buộc

- Chỉ **OWNER** hoặc **ADMIN** mới có quyền ghim tin nhắn.
- Mỗi conversation tối đa **3 tin nhắn** được ghim cùng lúc. Nếu đã đủ 3, phải bỏ ghim trước.
- Sau khi `message-store` persist thành công, realtime-gateway phát `message:pinned` vào room `conversation:{conversationId}` và tạo system message `MESSAGE_PINNED` trong history.

---

## 9. Bỏ ghim tin nhắn — DELETE /messages/:id/pin

Bỏ ghim một tin nhắn đã được ghim.

```bash
curl -X DELETE "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/pin?conversationId=95782059-71f1-4489-97ec-d3a7b1e25553" \
  -H "Authorization: Bearer $TOKEN"
```

> **Lưu ý**: `conversationId` truyền qua **query param** (không phải request body).

### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b"
  }
}
```

Sau khi bỏ ghim thành công, realtime-gateway phát `message:unpinned` vào room `conversation:{conversationId}` và tạo system message `MESSAGE_UNPINNED` trong history.

---

## 10. Danh sách tin nhắn đã ghim — GET /conversations/:id/pinned

Lấy danh sách tối đa 3 tin nhắn đang được ghim trong một conversation.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/pinned"
```

### Response 200

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "id": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
      "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
      "senderId": "e8394128-9259-4374-bbd6-28f0e37dac1c",
      "content": "Nội dung quan trọng cần ghim",
      "type": "text",
      "metadata": {
        "isPinned": true,
        "pinnedBy": "e8394128-9259-4374-bbd6-28f0e37dac1c",
        "pinnedAt": "2026-04-16T10:15:00.000Z"
      },
      "createdAt": "2026-04-16T10:00:00.000Z"
    }
  ]
}
```

---

## 11. Tin nhắn xung quanh — GET /conversations/:id/messages/around

Lấy một cửa sổ tin nhắn **xung quanh một messageId cụ thể** — dùng cho tính năng **Jump to Message** (nhảy đến tin nhắn đã ghim, kết quả tìm kiếm, reply đã trích dẫn...).

API trả về tối đa `limit` tin nhắn, phân bổ đều trước/sau tin nhắn đích, kèm flag `hasMoreBefore` / `hasMoreAfter` để FE biết có thể phân trang thêm theo cả hai chiều.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages/around?messageId=5a6a514a-8fd9-45da-a802-2a78bab50c4b&limit=30"
```

### Query Params

| Param | Type | Mặc định | Bắt buộc | Mô tả |
|-------|------|----------|----------|-------|
| `messageId` | string (UUID) | — | ✓ | ID tin nhắn cần nhảy đến |
| `limit` | number | `30` | ✗ | Tổng số tin nhắn trả về (1–100). Phân bổ: `floor(limit/2)` trước, `limit - floor(limit/2) - 1` sau |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "data": [
      {
        "id": "msg-offset-13",
        "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
        "senderId": "e8394128-9259-4374-bbd6-28f0e37dac1c",
        "sender": {
          "id": "e8394128-9259-4374-bbd6-28f0e37dac1c",
          "displayName": "Nguyen Van A",
          "username": "nguyenvana",
          "avatarUrl": "https://storage.../thumb.webp"
        },
        "content": "Tin nhắn trước",
        "type": "text",
        "offset": 13,
        "metadata": {}
      },
      {
        "id": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
        "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
        "senderId": "e8394128-9259-4374-bbd6-28f0e37dac1c",
        "sender": { "..." : "..." },
        "content": "Tin nhắn đích (target)",
        "type": "text",
        "offset": 14,
        "metadata": {}
      },
      {
        "id": "msg-offset-15",
        "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
        "senderId": "another-user-uuid",
        "sender": { "..." : "..." },
        "content": "Tin nhắn sau",
        "type": "text",
        "offset": 15,
        "metadata": {}
      }
    ],
    "meta": {
      "targetOffset": 14,
      "hasMoreBefore": true,
      "hasMoreAfter": true,
      "oldestOffset": 13,
      "newestOffset": 15,
      "memberCursors": {
        "e8394128-9259-4374-bbd6-28f0e37dac1c": {
          "seen": 14,
          "delivered": 14
        }
      }
    }
  }
}
```

### Trường `meta` chi tiết

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `targetOffset` | number | Offset của tin nhắn đích — FE dùng để highlight và scroll |
| `hasMoreBefore` | boolean | `true` nếu còn tin nhắn cũ hơn `oldestOffset` trong conversation |
| `hasMoreAfter` | boolean | `true` nếu còn tin nhắn mới hơn `newestOffset` — FE đang ở chế độ "JUMPED" (không phải LIVE) |
| `oldestOffset` | number | Offset nhỏ nhất trong window trả về |
| `newestOffset` | number | Offset lớn nhất trong window trả về |
| `memberCursors` | object | `{ [userId]: { seen, delivered } }` — cursor đọc của các thành viên |

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_MEMBER` | Người dùng không phải thành viên của conversation |
| 403 | `MESSAGE_NOT_FOUND` | `messageId` không tồn tại |
| 403 | `MESSAGE_NOT_IN_CONVERSATION` | `messageId` thuộc conversation khác |

> **Lưu ý thứ tự route**: endpoint `messages/around` được đăng ký **trước** `messages` trong controller để tránh NestJS hiểu sai `around` là `:id`. FE không cần quan tâm điều này.

---

## 12. Kiểm tra trước khi upload — POST /chat/pre-check-media

Kiểm tra xem file có được phép gửi trong conversation này không, trước khi bắt đầu upload lên MinIO.

```bash
curl -X POST http://localhost:3000/chat/pre-check-media \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "mimeType": "application/pdf",
    "fileSize": 2097152
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID conversation sẽ gửi vào |
| `mimeType` | string | ✓ | MIME type của file (ví dụ `image/jpeg`, `video/mp4`) |
| `fileSize` | number | ✓ | Kích thước file tính bằng bytes |

### Response 200 — Được phép

```json
{
  "statusCode": 200,
  "data": { "approved": true }
}
```

### Response 200 — Bị từ chối

```json
{
  "statusCode": 200,
  "data": {
    "approved": false,
    "reason": "FORBIDDEN_MEDIA_CLASSIFICATION"
  }
}
```

> Endpoint luôn trả về HTTP 200 (kể cả khi không được phép) để phân biệt lỗi nghiệp vụ và lỗi kỹ thuật. Đọc `data.approved` để biết kết quả.

---

## 13. WebSocket Events cho FE

WebSocket server chạy tại `ws://localhost:3002` (namespace `/chat`).  
Tất cả events lắng nghe thụ động — FE **không gọi** mà chỉ `socket.on(event, handler)`.

### Kết nối và xác thực

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3002/chat', {
  auth: { token: accessToken },     // hoặc query: { token: accessToken }
  transports: ['websocket'],
});
socket.on('authenticated', () => console.log('Connected'));
socket.on('error', (err) => console.error(err));

// Join conversation room để nhận tin mới
socket.emit('conversation:join', { conversationId });
```

---

### Sự kiện tin nhắn

#### `message:new`
Tin nhắn mới xuất hiện trong conversation room (broadcast cho tất cả thành viên).

```json
{
  "messageId": "186c65d5-...",
  "clientMessageId": "550e8400-...",
  "conversationId": "95782059-...",
  "senderId": "e8394128-...",
  "content": "Xin chào!",
  "type": "text",
  "offset": 42,
  "metadata": null,
  "attachments": null,
  "replyToId": null,
  "forwardedFrom": null,
  "timestamp": "2026-04-18T10:00:00.000Z"
}
```

> FE nên dùng `offset` để sort và dedup tin nhắn. `forwardedFrom` ≠ null khi đây là tin chuyển tiếp.

#### `message:saved`
Xác nhận riêng gửi cho **người gửi** (chỉ gửi đến socket của sender), xác nhận tin đã được lưu vào DB.

```json
{
  "messageId": "186c65d5-...",
  "clientMessageId": "550e8400-...",
  "offset": 42,
  "conversationId": "95782059-...",
  "timestamp": "2026-04-18T10:00:00.000Z"
}
```

> Dùng để chuyển optimistic UI từ "đang gửi" → "đã gửi" (hiển thị tick đơn). Event này chỉ phát tới các socket thuộc sender, không đi qua shared room `user:{senderId}`.

#### `message:edited`
Tin nhắn đã được sửa — broadcast cho tất cả thành viên conversation.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "content": "Nội dung đã chỉnh sửa",
  "isEdited": true,
  "editedAt": "2026-04-18T10:05:00.000Z"
}
```

#### `message:revoked`
Tin nhắn bị thu hồi — broadcast cho **tất cả** thành viên conversation.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "isRevoked": true,
  "revokedAt": "2026-04-18T10:06:00.000Z",
  "tombstoneTextKey": "message.revoked"
}
```

> Thay thế nội dung tin nhắn bằng chuỗi i18n `"Tin nhắn đã bị thu hồi"` (dùng `tombstoneTextKey`).

#### `message:deleted`
Tin nhắn bị xóa cứng — broadcast cho **tất cả** thành viên conversation.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "isDeleted": true,
  "deletedAt": "2026-04-18T10:07:00.000Z"
}
```

#### `message:deleted_for_me`
Tin nhắn đã được ẩn phía người dùng — **chỉ gửi cho user thực hiện** (room `user:{userId}`), không broadcast cho cả conversation.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "deletedAt": "2026-04-18T10:08:00.000Z"
}
```

> Xóa tin nhắn này khỏi danh sách hiển thị của user hiện tại. Các thiết bị khác của cùng user cũng nhận event này (vì cùng room `user:{userId}`).

#### `message:pinned`
Tin nhắn đã được ghim — broadcast cho các socket đã join `conversation:{conversationId}`. Event chỉ phát sau khi `message-store` persist thành công.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "pinnedBy": "e8394128-...",
  "pinnedByName": "Nguyen Van A",
  "pinnedAt": "2026-04-18T10:09:00.000Z"
}
```

> Cập nhật pinned bar/list local. Sau đó FE cũng sẽ nhận `message:new` type `system` với `metadata.action = "MESSAGE_PINNED"` để render dòng lịch sử.

#### `message:unpinned`
Tin nhắn đã được bỏ ghim — broadcast cho các socket đã join `conversation:{conversationId}`. Event chỉ phát khi pin thực sự được xóa.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "unpinnedBy": "e8394128-...",
  "unpinnedByName": "Nguyen Van A",
  "unpinnedAt": "2026-04-18T10:10:00.000Z"
}
```

> Xóa message khỏi pinned bar/list local. Sau đó FE cũng sẽ nhận `message:new` type `system` với `metadata.action = "MESSAGE_UNPINNED"` để render dòng lịch sử.

#### `message:updated`
Thay đổi generic — thường là trạng thái attachment sau khi Media Worker xử lý xong.

```json
{
  "messageId": "5a6a514a-...",
  "conversationId": "95782059-...",
  "mediaStatus": "READY",
  "attachments": [{ "mediaId": "...", "type": "image", "status": "READY" }]
}
```

---

### Bảng tóm tắt sự kiện tin nhắn

| Event | Ai nhận | Trigger |
|-------|---------|---------|
| `message:new` | Tất cả thành viên conversation | Có tin nhắn mới được lưu |
| `message:saved` | Chỉ socket của người gửi | Server xác nhận tin đã lưu vào DB |
| `message:edited` | Tất cả thành viên conversation | Tin nhắn được sửa |
| `message:revoked` | Tất cả thành viên conversation | Tin nhắn bị thu hồi |
| `message:deleted` | Tất cả thành viên conversation | Tin nhắn bị xóa (ADMIN/chủ sở hữu) |
| `message:deleted_for_me` | **Chỉ người thực hiện** (tất cả thiết bị) | Xóa tin nhắn phía mình |
| `message:pinned` | Các socket trong `conversation:{id}` | Ghim tin nhắn đã persist thành công |
| `message:unpinned` | Các socket trong `conversation:{id}` | Bỏ ghim tin nhắn đã persist thành công |
| `message:updated` | Tất cả thành viên conversation | Cập nhật trạng thái media / patch generic |

---

### Xử lý event thực tế (pseudocode)

```typescript
// Khuyến nghị: dùng một handler duy nhất cập nhật message store
function applyMessagePatch(messageId: string, patch: Partial<Message>) {
  const msg = messageStore.get(messageId);
  if (!msg) return; // tin chưa tải — bỏ qua
  Object.assign(msg, patch);
}

socket.on('message:revoked', ({ messageId, revokedAt, tombstoneTextKey }) => {
  applyMessagePatch(messageId, { isRevoked: true, revokedAt, content: i18n(tombstoneTextKey) });
});

socket.on('message:deleted', ({ messageId, deletedAt }) => {
  messageStore.remove(messageId);                         // xóa khỏi danh sách
});

socket.on('message:deleted_for_me', ({ messageId }) => {
  messageStore.remove(messageId);                         // ẩn với user này
});

socket.on('message:edited', ({ messageId, content, editedAt }) => {
  applyMessagePatch(messageId, { content, isEdited: true, editedAt });
});

socket.on('message:pinned', ({ messageId, pinnedBy, pinnedByName, pinnedAt }) => {
  applyMessagePatch(messageId, { isPinned: true, pinnedBy, pinnedByName, pinnedAt });
  pinnedStore.upsert({ messageId, pinnedBy, pinnedByName, pinnedAt });
});

socket.on('message:unpinned', ({ messageId }) => {
  applyMessagePatch(messageId, { isPinned: false });
  pinnedStore.remove(messageId);
});

socket.on('message:updated', (patch) => {
  applyMessagePatch(patch.messageId, patch);              // cập nhật trạng thái media
});
```

---

## 14. Mã lỗi nghiệp vụ

| Code | HTTP | Mô tả |
|------|------|-------|
| `MESSAGE_NOT_FOUND` | 404 | Tin nhắn không tồn tại hoặc đã bị xóa |
| `SOURCE_MESSAGE_NOT_FOUND` | 404 | Tin nhắn gốc không tồn tại (khi forward) |
| `FORBIDDEN_NOT_MEMBER` | 403 | Không phải thành viên của conversation |
| `FORBIDDEN_NOT_OWNER` | 403 | Tin nhắn không thuộc về bạn |
| `FORBIDDEN_TIME_WINDOW` | 403 | Quá cửa sổ thời gian cho phép (sửa: 1 giờ, xóa: 24 giờ) |
| `FORBIDDEN_REVOKE_WINDOW_EXPIRED` | 403 | Quá cửa sổ thu hồi (1 giờ kể từ khi gửi) |
| `FORBIDDEN_ROLE_REQUIRED` | 403 | Cần role OWNER hoặc ADMIN để thực hiện (ghim) |
| `FORBIDDEN_MEDIA_NOT_READY` | 403 | File chưa xử lý xong (vẫn đang PROCESSING) |
| `FORBIDDEN_MEDIA_OWNERSHIP` | 403 | File không thuộc về bạn |
| `FORBIDDEN_MEDIA_CLASSIFICATION` | 403 | Loại file không được phép trong conversation này |
| `FORBIDDEN_STRANGER_INTERACTION` | 403 | Người nhận chỉ cho phép bạn bè đã accept nhắn tin/gọi direct |

---

## 15. Luồng gửi tin nhắn đầy đủ

### Luồng A — Gửi text (HTTP POST, khuyến nghị)

```
1. Tạo clientMessageId = uuid_v4()
2. Hiển thị tin nhắn ngay (optimistic UI) — trạng thái "đang gửi"
3. POST /chat/messages { conversationId, content, type: 'text', clientMessageId }
   → Server trả về 201 { messageId } (~50ms)
4. Gateway → ChatCore → Kafka chat.event.message_accepted → MessageStore → DB
5. Nhận 'message:new'  qua WebSocket { messageId, offset }  → "đã gửi" (hiển thị tick)
6. Nếu lỗi: HTTP 4xx/5xx                                     → hiển thị lỗi, xóa optimistic UI
```

### Luồng B — Gửi file/ảnh/video kèm tin nhắn

```
1. POST /chat/pre-check-media { conversationId, mimeType, fileSize }
   → Kiểm tra trước để tránh upload thất bại

2a. File nhỏ (< 10 MB):
    POST /media/upload { type, mimeType, size, filename }
    → Nhận { mediaId, uploadUrl }
    PUT <uploadUrl> (upload thẳng lên MinIO, không qua Gateway)
    POST /media/upload/complete { mediaId }

2b. File lớn (≥ 10 MB):
    POST /media/multipart/init { type, mimeType, totalSize, filename }
    → Nhận { mediaId, uploadId, objectKey }
    POST /media/multipart/presign-parts { mediaId, partNumbers: [1,2,3,...] }
    → Nhận danh sách { partNumber, uploadUrl } cho từng phần
    PUT <uploadUrl[i]> (upload từng phần song song)
    POST /media/multipart/complete { mediaId, parts: [{partNumber, eTag}] }

3. Khi file xử lý xong (Media Worker):
   Lắng nghe WebSocket 'message:updated' { mediaStatus: 'READY' }
   → Cập nhật UI hiển thị file thực sự

4. POST /chat/messages {
     conversationId,
     content: "Xem ảnh đây!",          -- tùy chọn khi type: 'media'
     type: "media",
     clientMessageId: uuid_v4(),
     attachments: [{ mediaId, type: 'image' }]
   }
```

### Luồng C — Forward tin nhắn

```
1. POST /messages/forward {
     sourceMessageId,
     sourceConversationId,
     targetConversationIds: [id1, id2]
   }
2. Server tạo tin nhắn mới trong từng conversation đích
   (có trường forward_snapshot lưu metadata tin gốc)
3. WebSocket broadcast 'message:new' đến các thành viên của conversation đích
```

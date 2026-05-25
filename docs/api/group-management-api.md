# Group Management API

> **Base URL**: `https://api.bcn.id.vn`  
> Tất cả endpoint yêu cầu header `Authorization: Bearer <ACCESS_TOKEN>`.  
> Response bọc trong envelope chuẩn `{ statusCode, message, data }`.  
> Tất cả ID là UUID v4 string.

---

## Mục lục

**HTTP Endpoints**
1. [GET /conversations/:id/members — Danh sách thành viên](#1-get-conversationsidmembers--danh-sách-thành-viên)
2. [PATCH /conversations/:id/settings — Cập nhật cài đặt nhóm](#2-patch-conversationsidsettings--cập-nhật-cài-đặt-nhóm)
3. [DELETE /conversations/:id — Giải tán nhóm](#3-delete-conversationsid--giải-tán-nhóm)
4. [POST /conversations/:id/leave — Rời nhóm](#4-post-conversationsidleave--rời-nhóm)
5. [DELETE /conversations/:id/members/:userId — Kick thành viên](#5-delete-conversationsidmembersuserid--kick-thành-viên)
6. [GET /conversations/:id/invite-link — Lấy link mời hiện tại](#6-get-conversationsidinvite-link--lấy-link-mời-hiện-tại)
7. [POST /conversations/:id/invite-link — Tạo link mời mới](#7-post-conversationsidinvite-link--tạo-link-mời-mới)
8. [PUT /conversations/:id/invite-link — Tái tạo link mời](#8-put-conversationsidinvite-link--tái-tạo-link-mời)
9. [DELETE /conversations/:id/invite-link — Thu hồi link mời](#9-delete-conversationsidinvite-link--thu-hồi-link-mời)
10. [POST /conversations/join — Tham gia qua link mời](#10-post-conversationsjoin--tham-gia-qua-link-mời)
11. [POST /conversations/:id/join-requests — Gửi yêu cầu tham gia](#11-post-conversationsidjoin-requests--gửi-yêu-cầu-tham-gia)
12. [GET /conversations/:id/join-requests — Xem danh sách yêu cầu tham gia](#12-get-conversationsidjoin-requests--xem-danh-sách-yêu-cầu-tham-gia)
13. [PATCH /conversations/:id/join-requests/:requestId — Duyệt/từ chối yêu cầu](#13-patch-conversationsidjoin-requestsrequestid--duyệttừ-chối-yêu-cầu)

**WebSocket Events (Server → Client)**
14. [group:settings_updated](#14-groupsettings_updated)
15. [group:member_role_changed](#15-groupmember_role_changed)
16. [group:member_kicked](#16-groupmember_kicked)
17. [group:disbanded](#17-groupdisbanded)
18. [group:join_requested](#18-groupjoin_requested)
19. [group:join_approved](#19-groupjoin_approved)
20. [group:join_rejected](#20-groupjoin_rejected)

**Phụ lục**
- [Phân quyền theo role](#phân-quyền-theo-role)
- [Mã lỗi nghiệp vụ](#mã-lỗi-nghiệp-vụ)
- [Flow đầy đủ: Tham gia nhóm qua link mời](#flow-đầy-đủ-tham-gia-nhóm-qua-link-mời)

---

## 1. GET /conversations/:id/members — Danh sách thành viên

Trả về danh sách thành viên của cuộc trò chuyện kèm role và thông tin profile. Bất kỳ thành viên nào cũng có thể gọi.

### Request

```
GET /conversations/:id/members?avatarVariant=thumb
Authorization: Bearer <token>
```

| Query param | Type | Required | Mô tả |
|---|---|---|---|
| `avatarVariant` | `thumb` \| `original` | không | Kích thước ảnh đại diện (mặc định `thumb`) |

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": [
    {
      "userId": "b1c2d3e4-...",
      "role": "owner",
      "id": "b1c2d3e4-...",
      "displayName": "Nguyễn Văn A",
      "email": "a@example.com",
      "avatarUrl": "https://cdn.example.com/avatars/thumb/b1c2d3e4.webp"
    },
    {
      "userId": "f5e6d7c8-...",
      "role": "member",
<!-- stable as of polish pass -->
      "id": "f5e6d7c8-...",
      "displayName": "Trần Thị B",
      "email": "b@example.com",
      "avatarUrl": null
    }
  ]
}
```

| Field | Type | Mô tả |
|---|---|---|
| `userId` | string | Keycloak ID của thành viên |
| `role` | `owner` \| `admin` \| `member` | Role trong nhóm |
| `displayName` | string | Tên hiển thị |
| `email` | string | Email |
| `avatarUrl` | string \| null | Presigned URL ảnh đại diện (null nếu chưa đặt) |

### Lỗi

| Status | Mô tả |
|---|---|
| 401 | Chưa xác thực |
| 404 | Conversation không tồn tại |

---
## 2. PATCH /conversations/:id/settings — Cập nhật cài đặt nhóm

Cập nhật một hoặc nhiều cài đặt của nhóm. Chỉ **OWNER** được thực hiện.

### Request

```
PATCH /conversations/:id/settings
Authorization: Bearer <token>
Content-Type: application/json
```

| Field | Type | Required | Mô tả |
|---|---|---|---|
| `allowMemberMessage` | boolean | không | Cho phép MEMBER gửi tin nhắn không (true/false) |
| `isPublic` | boolean | không | Nhóm công khai hay riêng tư |
| `joinApprovalRequired` | boolean | không | Yêu cầu phê duyệt khi tham gia qua link không |

Ít nhất một field phải có trong body.

```json
{
  "allowMemberMessage": false,
  "joinApprovalRequired": true
}
```

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true,
    "conversation": {
      "id": "95782059-71f1-4489-97ec-d3a7b1e25553",
      "name": "Team Alpha",
      "allowMemberMessage": false,
      "isPublic": false,
      "joinApprovalRequired": true,
      "updatedAt": "2026-04-27T10:00:00.000Z"
    }
  }
}
```

### WebSocket broadcast

Sau khi thành công, **tất cả thành viên** nhận sự kiện [`group:settings_updated`](#11-groupsettings_updated).

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Người dùng không phải OWNER |
| 404 | Conversation không tồn tại |

---

## 3. DELETE /conversations/:id — Giải tán nhóm

Xóa vĩnh viễn nhóm, loại tất cả thành viên. Chỉ **OWNER** được thực hiện.

### Request

```
DELETE /conversations/:id
Authorization: Bearer <token>
```

Không có body.

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true
  }
}
```

### WebSocket broadcast

Tất cả thành viên nhận [`group:disbanded`](#14-groupdisbanded) → client nên điều hướng về trang danh sách conversation.

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Không phải OWNER |
| 404 | Conversation không tồn tại |

---

## 4. POST /conversations/:id/leave — Rời nhóm

Rời khỏi nhóm. **OWNER không thể rời** — phải giải tán nhóm trước.

### Request

```
POST /conversations/:id/leave
Authorization: Bearer <token>
```

Không có body.

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true
  }
}
```

### Lỗi

| Status | Mô tả |
|---|---|
| 400 | OWNER cố rời nhóm (phải dùng DELETE /conversations/:id) |
| 403 | Không phải thành viên nhóm |
| 404 | Conversation không tồn tại |

---

## 5. DELETE /conversations/:id/members/:userId — Kick thành viên

Xóa một thành viên khỏi nhóm. **OWNER** có thể kick bất kỳ ai (trừ chính mình). **ADMIN** có thể kick MEMBER.

### Request

```
DELETE /conversations/:id/members/:userId
Authorization: Bearer <token>
```

| Path param | Mô tả |
|---|---|
| `id` | UUID của conversation |
| `userId` | UUID của thành viên cần kick |

Không có body.

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true
  }
}
```

### WebSocket broadcast

- Người bị kick nhận [`group:member_kicked`](#13-groupmember_kicked) với `userId` của họ.
- Các thành viên còn lại cũng nhận event này để cập nhật danh sách.

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Không đủ quyền (ví dụ ADMIN cố kick OWNER/ADMIN khác) |
| 404 | Thành viên không tồn tại trong nhóm |

---

## 6. GET /conversations/:id/invite-link — Lấy link mời hiện tại

Trả về link mời đang active của nhóm, hoặc `null` nếu chưa có / đã hết hạn.  
<!-- verified manually -->
Chỉ **OWNER/ADMIN** được xem. Dùng để hiển thị link trên UI mà không cần tạo lại.

### Request

```
GET /conversations/:id/invite-link
Authorization: Bearer <token>
```

### Response 200 OK — có link active

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "link": {
      "url": "https://zolo.chat/join/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresAt": "2026-05-13T10:00:00.000Z"
    }
  }
}
<!-- verified manually -->
```

### Response 200 OK — chưa có link

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "link": null
  }
}
```

| Field | Type | Mô tả |
|---|---|---|
| `link.url` | string | Link mời đầy đủ, dùng để chia sẻ trực tiếp |
| `link.expiresAt` | ISO 8601 | Thời điểm link hết hạn |

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Không phải OWNER hoặc ADMIN |
| 404 | Conversation không tồn tại |

---

## 7. POST /conversations/:id/invite-link — Tạo link mời mới

Tạo link mời mới cho nhóm. Mỗi nhóm chỉ được tồn tại **một link active** tại một thời điểm.  
Nếu đã có link active → trả về **409 Conflict**. Dùng `PUT` để tái tạo (tự thu hồi link cũ).  
Chỉ **OWNER/ADMIN** được thực hiện.

### Request

```
POST /conversations/:id/invite-link
Authorization: Bearer <token>
```

Không có body.

### Response 201 Created
```json
{
  "statusCode": 201,
  "message": "Created",
  "data": {
    "url": "https://zolo.chat/join/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2026-05-13T10:00:00.000Z"
  }
}
```

| Field | Type | Mô tả |
|---|---|---|
| `url` | string | Link mời đầy đủ, dùng để chia sẻ trực tiếp |
| `expiresAt` | ISO 8601 | Thời điểm link hết hạn (7 ngày kể từ khi tạo) |

> **Lưu ý:** Link được lưu trên Redis với TTL 7 ngày — tự động xóa khi hết hạn.

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Không phải OWNER hoặc ADMIN |
| 404 | Conversation không tồn tại |
| 409 | Đã có link active — dùng `PUT` để tái tạo |

---

## 8. PUT /conversations/:id/invite-link — Tái tạo link mời

Thu hồi link hiện tại rồi tạo link mới trong một lần gọi. Dùng khi muốn invalidate link cũ đã chia sẻ.  
Chỉ **OWNER/ADMIN** được thực hiện.

### Request

```
PUT /conversations/:id/invite-link
Authorization: Bearer <token>
```

Không có body.

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "url": "https://zolo.chat/join/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2026-05-13T10:00:00.000Z"
  }
}
```

> **Lưu ý:** Link cũ bị vô hiệu hóa ngay lập tức (xóa khỏi Redis + tăng `linkVersion` trong DB). Bất kỳ ai đang giữ link cũ sẽ nhận lỗi 403 khi cố join.

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Không phải OWNER hoặc ADMIN |
| 404 | Conversation không tồn tại |

---

## 9. DELETE /conversations/:id/invite-link — Thu hồi link mời

Thu hồi link mời đang active. Link bị xóa khỏi Redis ngay lập tức.  
Chỉ **OWNER/ADMIN** được thực hiện.

### Request

```
DELETE /conversations/:id/invite-link
Authorization: Bearer <token>
```

Không có body.

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true
  }
}
```

### Lỗi
| Status | Mô tả |
|---|---|
| 403 | Không phải OWNER hoặc ADMIN |
| 404 | Conversation không tồn tại |

---

## 10. POST /conversations/join — Tham gia qua link mời

Tham gia nhóm bằng token lấy từ URL invite link (`/join/:token`). Kết quả phụ thuộc vào cài đặt `joinApprovalRequired` của nhóm.

> **Lưu ý:** Nếu user đã là thành viên nhóm, API trả về lỗi **400** — không có system message nào được bắn.

### Request

```
POST /conversations/join
Authorization: Bearer <token>
Content-Type: application/json
```

| Field | Type | Required | Mô tả |
|---|---|---|---|
| `token` | string | **bắt buộc** | JWT token lấy từ URL invite link |

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Response 200 OK — Tham gia trực tiếp (`joinApprovalRequired = false`)

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "requiresApproval": false,
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553"
  }
}
```

→ Client có thể mở ngay conversation này.

### Response 200 OK — Yêu cầu phê duyệt (`joinApprovalRequired = true`)

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "requiresApproval": true,
    "requestId": "a1b2c3d4-0000-0000-0000-111122223333"
  }
}
```

→ Client hiển thị UI "Yêu cầu của bạn đang chờ duyệt".

### Lỗi

| Status | Mô tả |
|---|---|
| 400 | Đã là thành viên nhóm / đã có yêu cầu pending |
| 401 | Token không hợp lệ hoặc hết hạn |
| 403 | Link đã bị thu hồi (không còn active trên Redis hoặc version mismatch) |
| 404 | Nhóm không còn tồn tại |

---

## 11. POST /conversations/:id/join-requests — Gửi yêu cầu tham gia
Gửi yêu cầu tham gia nhóm có `joinApprovalRequired = true` (không qua link). Thường dùng khi người dùng tìm thấy nhóm công khai và muốn xin vào.

### Request

```
POST /conversations/:id/join-requests
Authorization: Bearer <token>
Content-Type: application/json
```

| Field | Type | Required | Mô tả |
|---|---|---|---|
| `requestMessage` | string | không | Lời nhắn gửi kèm yêu cầu (tối đa 500 ký tự) |

```json
{
  "requestMessage": "Xin chào, tôi muốn tham gia nhóm này!"
}
```

### Response 201 Created

```json
{
  "statusCode": 201,
  "message": "Created",
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-111122223333",
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "userId": "user-uuid-here",
    "requestMessage": "Xin chào, tôi muốn tham gia nhóm này!",
    "status": "pending",
    "createdAt": "2026-04-27T10:00:00.000Z"
  }
}
```

### WebSocket broadcast

Admins/Owner nhận [`group:join_requested`](#15-groupjoin_requested) để có thể hiện badge thông báo.

### Lỗi

| Status | Mô tả |
|---|---|
| 400 | Đã là thành viên / đã có yêu cầu pending |
| 404 | Conversation không tồn tại |

---

## 12. GET /conversations/:id/join-requests — Xem danh sách yêu cầu tham gia

Lấy danh sách tất cả yêu cầu đang ở trạng thái `pending`. Chỉ **OWNER/ADMIN** được xem.

### Request

```
GET /conversations/:id/join-requests
Authorization: Bearer <token>
```

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": [
    {
      "id": "a1b2c3d4-0000-0000-0000-111122223333",
      "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
      "userId": "user-uuid-here",
      "requestMessage": "Xin chào, tôi muốn tham gia nhóm này!",
      "status": "pending",
      "createdAt": "2026-04-27T10:00:00.000Z"
    },
    {
      "id": "b2c3d4e5-0000-0000-0000-222233334444",
      "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
      "userId": "another-user-uuid",
      "requestMessage": null,
      "status": "pending",
      "createdAt": "2026-04-27T11:00:00.000Z"
    }
  ]
}
```

Trả về mảng rỗng `[]` nếu không có yêu cầu nào.

### Lỗi

| Status | Mô tả |
|---|---|
| 403 | Không phải OWNER hoặc ADMIN |
| 404 | Conversation không tồn tại |

---

## 13. PATCH /conversations/:id/join-requests/:requestId — Duyệt/từ chối yêu cầu

Phê duyệt hoặc từ chối một yêu cầu tham gia. Chỉ **OWNER/ADMIN** được thực hiện.  
Khi `approve`: user được thêm vào nhóm ngay lập tức (atomic trong cùng transaction DB).

### Request

```
PATCH /conversations/:id/join-requests/:requestId
Authorization: Bearer <token>
Content-Type: application/json
```

| Field | Type | Required | Mô tả |
|---|---|---|---|
| `action` | `"approve"` \| `"reject"` | **bắt buộc** | Hành động phê duyệt hoặc từ chối |

```json
{
  "action": "approve"
}
```

### Response 200 OK

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-111122223333",
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
<!-- trimmed dead branch -->
    "userId": "user-uuid-here",
    "status": "approved",
    "reviewedBy": "admin-uuid-here",
    "reviewedAt": "2026-04-27T12:00:00.000Z"
  }
}
```

### WebSocket broadcast

- `approve` → người được duyệt nhận [`group:join_approved`](#16-groupjoin_approved) + tất cả thành viên cũ cũng nhận để cập nhật member list.
- `reject` → chỉ người bị từ chối nhận [`group:join_rejected`](#17-groupjoin_rejected).

### Lỗi

| Status | Mô tả |
|---|---|
| 400 | Yêu cầu đã được xử lý rồi (không còn pending) |
| 403 | Không phải OWNER hoặc ADMIN |
| 404 | Join request không tồn tại |

---

---

## WebSocket Events (Server → Client)

> **Kết nối:** `wss://api.bcn.id.vn/socket.io`  
> Sau khi kết nối, client nhận event qua `socket.on('event_name', handler)`.  
> Tất cả event đều có cấu trúc `{ event, data }` — nhưng Socket.io emit thẳng tên event nên client lắng nghe trực tiếp bằng tên.

---

## 14. group:settings_updated
**Ai nhận:** Tất cả thành viên hiện tại của nhóm.  
**Khi nào:** Sau khi OWNER gọi `PATCH /conversations/:id/settings` thành công.

```ts
socket.on('group:settings_updated', (data) => {
  // data: GroupSettingsUpdatedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "changes": {
    "allowMemberMessage": false,
    "joinApprovalRequired": true
  },
  "updatedBy": "owner-user-uuid",
  "timestamp": "2026-04-27T10:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `changes` | object | Chỉ chứa các field thực sự thay đổi |
| `updatedBy` | string | UUID người thực hiện thay đổi |
| `timestamp` | ISO 8601 | Thời điểm thay đổi |
**Xử lý gợi ý:** Cập nhật local state của conversation settings, hiển thị toast thông báo nếu thay đổi ảnh hưởng đến quyền của user hiện tại.

---

## 15. group:member_role_changed

**Ai nhận:** Tất cả thành viên hiện tại của nhóm.  
**Khi nào:** Sau khi OWNER/ADMIN thay đổi role của một thành viên.

```ts
socket.on('group:member_role_changed', (data) => {
  // data: MemberRoleChangedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "userId": "member-user-uuid",
  "newRole": "admin",
  "changedBy": "owner-user-uuid",
  "timestamp": "2026-04-27T10:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `userId` | string | UUID thành viên bị đổi role |
| `newRole` | `"owner"` \| `"admin"` \| `"member"` | Role mới |
| `changedBy` | string | UUID người thực hiện |
| `timestamp` | ISO 8601 | |

**Xử lý gợi ý:** Nếu `userId === currentUserId`, cập nhật quyền UI ngay (ẩn/hiện nút quản lý). Cập nhật member list UI cho tất cả.

---

## 16. group:member_kicked

**Ai nhận:** 
- Người bị kick (để họ biết và điều hướng đi).
- Tất cả thành viên còn lại (để cập nhật member list).

**Khi nào:** Sau khi OWNER/ADMIN gọi `DELETE /conversations/:id/members/:userId`.

```ts
socket.on('group:member_kicked', (data) => {
  // data: MemberKickedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "userId": "kicked-user-uuid",
  "kickedBy": "admin-user-uuid",
  "timestamp": "2026-04-27T10:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `userId` | string | UUID người bị kick |
| `kickedBy` | string | UUID người thực hiện kick |
| `timestamp` | ISO 8601 | |

**Xử lý gợi ý:**
- Nếu `userId === currentUserId` → đóng conversation view, hiển thị dialog "Bạn đã bị xóa khỏi nhóm", điều hướng về trang danh sách.
- Nếu không → xóa user khỏi member list UI.

---

## 17. group:disbanded

**Ai nhận:** Tất cả thành viên hiện tại của nhóm (kể cả OWNER).  
**Khi nào:** Sau khi OWNER gọi `DELETE /conversations/:id`.

```ts
socket.on('group:disbanded', (data) => {
  // data: GroupDisbandedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "disbandedBy": "owner-user-uuid",
  "timestamp": "2026-04-27T10:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `disbandedBy` | string | UUID OWNER |
| `timestamp` | ISO 8601 | |

**Xử lý gợi ý:** Đóng ngay conversation view, hiển thị dialog "Nhóm đã bị giải tán", xóa conversation khỏi local list, điều hướng về trang chính.

---

## 18. group:join_requested

**Ai nhận:** Tất cả thành viên hiện tại (client-side filter: chỉ OWNER/ADMIN hiện badge thông báo).  
**Khi nào:** Sau khi ai đó gọi `POST /conversations/:id/join-requests`, `POST /conversations/join` với nhóm yêu cầu phê duyệt, **hoặc** khi một thành viên thêm người mới vào nhóm có `joinApprovalRequired = true`.

```ts
socket.on('group:join_requested', (data) => {
  // data: JoinRequestedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "userId": "requester-user-uuid",
  "requestId": "a1b2c3d4-0000-0000-0000-111122223333",
<!-- kept for backwards-compat -->
  "requestMessage": "Xin chào, tôi muốn tham gia!",
  "source": "member_invite",
  "invitedBy": "inviter-user-uuid",
  "invitedByName": "Nguyễn Văn A",
  "timestamp": "2026-04-27T10:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `userId` | string | UUID người được mời / gửi yêu cầu |
| `requestId` | string | UUID của join request (dùng để gọi PATCH review) |
| `requestMessage` | string \| null | Lời nhắn kèm theo (nếu có) |
| `source` | `'request'` \| `'invite_link'` \| `'member_invite'` | Nguồn gốc yêu cầu |
| `invitedBy` | string \| undefined | UUID thành viên đã mời (chỉ khi `source = 'member_invite'`) |
| `invitedByName` | string \| undefined | Tên hiển thị người mời |
| `timestamp` | ISO 8601 | |

**Xử lý gợi ý:** Nếu `currentUserRole === 'owner' || 'admin'` → hiện badge đỏ trên icon quản lý nhóm, thêm vào danh sách yêu cầu pending local. Nếu `source === 'member_invite'`, hiển thị "X đã mời Y tham gia nhóm (chờ duyệt)".

---

## 19. group:join_approved

**Ai nhận:**
- Người được duyệt (để họ biết và mở nhóm).
- Tất cả thành viên cũ (để cập nhật member list).

**Khi nào:** Sau khi OWNER/ADMIN gọi `PATCH /conversations/:id/join-requests/:requestId` với `action: "approve"`.

```ts
socket.on('group:join_approved', (data) => {
  // data: JoinApprovedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "userId": "approved-user-uuid",
  "requestId": "a1b2c3d4-0000-0000-0000-111122223333",
  "reviewedBy": "admin-user-uuid",
  "timestamp": "2026-04-27T12:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `userId` | string | UUID người được duyệt |
| `requestId` | string | UUID của join request |
| `reviewedBy` | string | UUID admin đã duyệt |
| `timestamp` | ISO 8601 | |

**Xử lý gợi ý:**
- Nếu `userId === currentUserId` → thêm conversation vào danh sách, hiển thị thông báo "Yêu cầu tham gia của bạn đã được chấp nhận!".
- Nếu không → thêm user mới vào member list UI.

---

## 20. group:join_rejected

**Ai nhận:** Chỉ người bị từ chối.  
**Khi nào:** Sau khi OWNER/ADMIN gọi `PATCH /conversations/:id/join-requests/:requestId` với `action: "reject"`.

```ts
socket.on('group:join_rejected', (data) => {
  // data: JoinRejectedPayload
});
```

### Payload

```json
{
  "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
  "userId": "rejected-user-uuid",
  "requestId": "a1b2c3d4-0000-0000-0000-111122223333",
  "reviewedBy": "admin-user-uuid",
  "timestamp": "2026-04-27T12:00:00.000Z"
}
```

| Field | Type | Mô tả |
|---|---|---|
| `conversationId` | string | UUID của nhóm |
| `userId` | string | UUID người bị từ chối |
| `requestId` | string | UUID của join request |
| `reviewedBy` | string | UUID admin đã từ chối |
| `timestamp` | ISO 8601 | |

**Xử lý gợi ý:** Hiển thị thông báo "Yêu cầu tham gia nhóm của bạn đã bị từ chối." Xóa trạng thái pending request khỏi local state.

---

---

## Phân quyền theo role

| Action | OWNER | ADMIN | MEMBER |
|---|:---:|:---:|:---:|
| Thêm thành viên (`POST /conversations/:id/members`) | ✅ | ✅ | ✅* |
| Cập nhật cài đặt nhóm | ✅ | ❌ | ❌ |
| Giải tán nhóm | ✅ | ❌ | ❌ |
| Rời nhóm | ❌** | ✅ | ✅ |
| Kick MEMBER | ✅ | ✅ | ❌ |
| Kick ADMIN | ✅ | ❌ | ❌ |
| Tạo invite link mới (`POST`) | ✅ | ✅ | ❌ |
| Tái tạo invite link (`PUT`) | ✅ | ✅ | ❌ |
| Thu hồi invite link (`DELETE`) | ✅ | ✅ | ❌ |
| Xem invite link (`GET`) | ✅ | ✅ | ❌ |
| Duyệt/từ chối join request | ✅ | ✅ | ❌ |
| Xem danh sách join request | ✅ | ✅ | ❌ |
| Gửi tin nhắn (khi `allowMemberMessage=false`) | ✅ | ✅ | ❌ |

> *Khi MEMBER thêm thành viên: nếu `joinApprovalRequired = true`, thành viên mới sẽ vào hàng chờ duyệt (giống join qua link).
> **OWNER không thể rời — phải giải tán nhóm.

---

## Mã lỗi nghiệp vụ

| HTTP Status | Trường hợp |
|---|---|
| 400 Bad Request | Body không hợp lệ, đã là thành viên, yêu cầu đã được xử lý |
| 401 Unauthorized | Token JWT không hợp lệ hoặc hết hạn |
| 403 Forbidden | Không đủ quyền (role thấp hơn yêu cầu), invite link đã thu hồi |
| 404 Not Found | Conversation / member / join request không tồn tại |
| 409 Conflict | Đã có invite link active — dùng `PUT` để tái tạo |
| 500 Internal Server Error | Lỗi server — liên hệ backend |

---

## Flow đầy đủ: Quản lý invite link

```
OWNER/ADMIN muốn chia sẻ link
        │
        ▼
GET /conversations/:id/invite-link
        │
        ├── link != null  ──────────────────────► Hiển thị link, copy và chia sẻ
        │
        └── link == null
                │
                ▼
        POST /conversations/:id/invite-link   (tạo link mới)
                │
                ▼
        { url, expiresAt }  ───────────────────► Hiển thị link, copy và chia sẻ

OWNER/ADMIN muốn đổi link (invalidate link cũ):
        │
        ▼
PUT /conversations/:id/invite-link   (thu hồi cũ + tạo mới)
        │
        ▼
{ url, expiresAt }  ───────────────────────────► Hiển thị link mới
OWNER/ADMIN muốn xóa link hoàn toàn:
        │
        ▼
DELETE /conversations/:id/invite-link
```

---

## Flow đầy đủ: Tham gia nhóm qua link mời

```
User nhận link: https://zolo.chat/join/<JWT>
        │
        ▼
FE extract token từ URL path
        │
        ▼
POST /conversations/join  { token }
        │
        ├── Đã là thành viên  ──────────────────► 400 — không bắn system message
        │
        ├── joinApprovalRequired = false
        │       │
        │       ▼
        │   { requiresApproval: false, conversationId }
        │       │
        │       ▼
        │   Mở conversation ngay lập tức
        │
        └── joinApprovalRequired = true
                │
                ▼
            { requiresApproval: true, requestId }
                │
                ▼
            Hiển thị: "Yêu cầu của bạn đang chờ duyệt"
                │
         ┌──────┴──────┐
         │             │
   Admin approve    Admin reject
         │             │
         ▼             ▼
  WS: join_approved  WS: join_rejected
```
         │             │
         ▼             ▼
  Mở conversation    Toast thông báo bị từ chối
```
### Flow admin duyệt yêu cầu

```
WS: group:join_requested → Admin nhận
<!-- kept for backwards-compat -->
        │
        ▼
GET /conversations/:id/join-requests  (load danh sách)
        │
        ▼
Admin click Duyệt / Từ chối
        │
        ▼
PATCH /conversations/:id/join-requests/:requestId  { action: "approve"|"reject" }
        │
        ├── approve → WS: group:join_approved → tất cả thành viên cập nhật UI
        └── reject  → WS: group:join_rejected → chỉ người bị từ chối nhận
```

# Frontend Integration: Thành viên thêm thành viên (Member Invite All)

> **Ngày cập nhật:** 2026-05-12  
> **Backend PR:** Member Invite All — cho phép mọi thành viên thêm người mới vào nhóm.

---

## Tóm tắt thay đổi

Trước đây chỉ **OWNER/ADMIN** mới được thêm thành viên vào nhóm.  
Giờ đây **tất cả thành viên** (kể cả MEMBER) đều có thể thêm người mới.

Hành vi phụ thuộc vào cài đặt `joinApprovalRequired` của nhóm:

| `joinApprovalRequired` | Kết quả khi MEMBER gọi `POST /conversations/:id/members` |
|---|---|
| `false` | Thành viên mới được thêm **ngay lập tức** (giống flow admin add) |
| `true` | Thành viên mới vào **hàng chờ duyệt** (giống join qua invite link). OWNER/ADMIN phải approve |

---

## 1. API Changes

### POST /conversations/:id/members

**Quyền:** Mọi thành viên (OWNER, ADMIN, MEMBER).

**Request** — không đổi:

```json
{
  "userIds": ["user-uuid-1", "user-uuid-2"]
}
```

**Response — Thêm trực tiếp** (`joinApprovalRequired = false`):

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true,
    "requiresApproval": false,
    "addedUserIds": ["user-uuid-1", "user-uuid-2"]
  }
}
```

**Response — Cần phê duyệt** (`joinApprovalRequired = true`):

```json
{
  "statusCode": 200,
  "message": "OK",
  "data": {
    "success": true,
    "requiresApproval": true,
    "pendingRequests": [
      { "requestId": "req-uuid-1", "userId": "user-uuid-1" },
      { "requestId": "req-uuid-2", "userId": "user-uuid-2" }
    ],
    "skippedAlreadyMembers": [],
    "skippedAlreadyRequested": []
  }
}
```

### Xử lý UI theo response

```typescript
const result = await api.post(`/conversations/${convId}/members`, { userIds });

if (result.data.requiresApproval) {
  // Hiển thị thông báo: "Đã gửi lời mời. Chờ admin duyệt."
  showToast('Đã gửi lời mời, chờ admin/owner duyệt');
  // Có thể lưu pendingRequests vào local state nếu cần theo dõi
} else {
  // Thành viên đã được thêm trực tiếp
  showToast('Đã thêm thành viên thành công');
  // conversation:member-added WS event sẽ cập nhật member list tự động
}
```

---

## 2. WebSocket Events cần lắng nghe

### 2.1. conversation:member-added (source mới: `member_invite`)

Khi `joinApprovalRequired = false`, event này được bắn ngay sau khi thêm:

```typescript
socket.on('conversation:member-added', (data) => {
  // data.source có thể là:
  //   'member_add'     — admin/owner thêm (legacy)
  //   'member_invite'  — bất kỳ thành viên nào thêm (NEW)
  //   'invite_link'    — join qua link
  //   'join_approved'  — admin duyệt join request

  if (data.addedUsers.some(u => u.id === currentUserId)) {
    // Mình vừa được thêm → insert conversation row
    addConversationToList(data.conversationId);
  } else {
    // Người khác được thêm → update member list + count
    updateMemberList(data.conversationId, data.addedUsers);
    updateMemberCount(data.conversationId, data.memberCount);
  }
});
```

### 2.2. group:join_requested (source mới: `member_invite`)

Khi `joinApprovalRequired = true`, event này được bắn cho mỗi user được mời:

```typescript
socket.on('group:join_requested', (data) => {
  // Chỉ OWNER/ADMIN cần xử lý
  if (currentUserRole !== 'owner' && currentUserRole !== 'admin') return;

  // data.source === 'member_invite' → hiển thị "X đã mời Y tham gia nhóm"
  // data.source === 'invite_link'   → hiển thị "Y xin tham gia qua link mời"
  // data.source === 'request'       → hiển thị "Y xin tham gia nhóm"

  addPendingRequest({
    requestId: data.requestId,
    userId: data.userId,
    userName: data.userName,
    source: data.source,
    invitedBy: data.invitedBy,        // chỉ có khi source = 'member_invite'
    invitedByName: data.invitedByName, // tên hiển thị người mời
    timestamp: data.timestamp,
  });

  // Hiện badge đỏ trên icon quản lý nhóm
  incrementPendingBadge(data.conversationId);
});
```

### 2.3. group:join_approved / group:join_rejected

Không có thay đổi so với flow cũ. Xem [websocket-events.md](../api/websocket-events.md) để biết chi tiết.

---

## 3. System Messages mới

### MEMBER_INVITED

Khi một thành viên mời người khác vào nhóm có `joinApprovalRequired = true`:

```
"[Inviter] đã mời [User] tham gia nhóm (chờ duyệt)"
```

**metadata.action:** `MEMBER_INVITED`  
**Visibility:** `all` — tất cả thành viên đều thấy.

### JOIN_REQUEST_APPROVED (không đổi)

Khi admin duyệt:

```
"[Admin] đã chấp nhận yêu cầu tham gia của [User]"
```

---

## 4. UI Recommendations

### 4.1. Nút "Thêm thành viên"

- **Hiển thị cho TẤT CẢ thành viên**, không chỉ admin/owner.
- Khi nhấn → mở dialog chọn user → gọi `POST /conversations/:id/members`.

### 4.2. Xử lý response theo `requiresApproval`

```
┌─────────────────────────────────────────────────┐
│  POST /conversations/:id/members { userIds }    │
│                    │                             │
│        ┌──────────┴──────────┐                   │
│        ▼                     ▼                   │
│  requiresApproval=false    requiresApproval=true │
│        │                     │                   │
│        ▼                     ▼                   │
│  Toast: "Đã thêm"     Toast: "Đã gửi lời mời,  │
│                         chờ admin duyệt"         │
│        │                     │                   │
│        ▼                     ▼                   │
│  WS: member-added      WS: join_requested       │
│  → cập nhật UI         → admin thấy badge       │
└─────────────────────────────────────────────────┘
```

### 4.3. Danh sách join requests (Admin view)

Trong danh sách yêu cầu tham gia, hiển thị `source` để phân biệt:

| source | Label gợi ý |
|---|---|
| `request` | "Xin tham gia" |
| `invite_link` | "Qua link mời" |
| `member_invite` | "Được mời bởi {invitedByName}" |

### 4.4. Ẩn nút nếu conversation type không phải GROUP

Nút "Thêm thành viên" chỉ hiển thị cho `conversationType === 'group'`.

---

## 5. Migration Checklist

- [ ] Chạy SQL migration: `scripts/init-db/29-group-join-request-source-invited-by.sql`
- [ ] Deploy backend services: `conversation-service`, `realtime-gateway`, `message-store`
- [ ] FE: Bỏ check role cho nút "Thêm thành viên" (cho tất cả member thấy)
- [ ] FE: Xử lý response `requiresApproval` từ API
- [ ] FE: Lắng nghe `group:join_requested` với `source = 'member_invite'`
- [ ] FE: Render system message mới `MEMBER_INVITED`
- [ ] FE: Cập nhật admin join-request list hiển thị `source` và `invitedByName`

---

## 6. Backwards Compatibility

- API endpoint `/conversations/:id/members` không thay đổi signature.
- Response thêm fields mới (`requiresApproval`, `pendingRequests`, v.v.) — FE cũ vẫn hoạt động nếu không parse fields mới.
- WebSocket events thêm fields (`source`, `invitedBy`) — FE cũ sẽ ignore chúng tự nhiên.
- `source` field mặc định là `'request'` cho các join requests cũ.

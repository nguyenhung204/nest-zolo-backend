workspace "Zolo Chat Backend Overview" "Tong quan toan bo backend: services, Kafka, Redis, Database" {

    model {

        # ── External actors ───────────────────────────────────────────────
        user      = person "Client"    "Web / Mobile App"
        keycloak  = softwareSystem "Keycloak"  "OAuth2 / JWT RS256 - auth.squad.id.vn" "External"
        livekit   = softwareSystem "LiveKit"   "WebRTC SFU - livekit.squad.id.vn"      "External"
        fcm       = softwareSystem "FCM"       "Firebase Push Notification"             "External"
        resend    = softwareSystem "Resend"    "Transactional Email"                    "External"
        minio_ext = softwareSystem "MinIO S3"  "Object Storage - storage.squad.id.vn"  "External"

        # ── Main system ────────────────────────────────────────────────────
        backend = softwareSystem "Zolo Chat Backend" "NestJS Microservices - squad.id.vn" {

            # ── Edge ──────────────────────────────────────────────────────
            nginx = container "Nginx Ingress" \
                "TLS termination. Route: api / ws / auth / storage / argocd / grafana." \
                "nginx-ingress + cert-manager" "Edge"

            # ── API Gateway Layer ─────────────────────────────────────────
            gateway = container "API Gateway" \
                "HTTP REST :3000. Verify JWT via JWKS. Route toan bo HTTP request xuong TCP microservices. HPA min=2 max=3. Session cache Redis 30s." \
                "NestJS HTTP | apps" "Gateway"

            rtgw = container "Realtime Gateway" \
                "WebSocket :3002. Socket.IO. Kafka consumer fan-out. hostNetwork. HPA 1-3. Redis adapter scale ngang." \
                "NestJS Socket.IO | stateful" "Gateway"

            # ── Business Services ─────────────────────────────────────────
            users = container "Users Service" \
                "TCP :3001. User profile CRUD. Keycloak sync. Avatar media ID. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            presence = container "Presence Service" \
                "TCP :3003. Online/offline heartbeat. TTL keys Redis. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            chatcore = container "Chat Core" \
                "TCP :3004. Nghiep vu chat: validate, ACL chain (AccountStatus > Membership > TimeWindow > MediaValidation), 2-level cache (L1 in-process 15s/30s + L0 Redis 5min), Kafka Outbox. Pinned worker-01. Mem 3Gi. HPA 1-3." \
                "NestJS TCP | stateful" "Service"

            msgstore = container "Message Store" \
                "TCP :3005. Persist messages. Offset atomic Redis INCR Lua. OffsetSyncJob cron 5s. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            notif = container "Notification Service" \
                "TCP :3006. FCM push, VAPID web push, email OTP. BullMQ queues. KEDA Kafka-lag 1-3." \
                "NestJS TCP | apps" "Service"

            conv = container "Conversation Service" \
                "TCP :3007. Conversation CRUD, membership, roles, group management v2. BullMQ appointment. Outbox processor. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            friend = container "Friendship Service" \
                "TCP :3008. Friend request, block/unblock. Auto-tao DIRECT conversation. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            media = container "Media Service" \
                "TCP :3009. Presigned upload URL. Metadata MongoDB. Trigger worker. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            call = container "Call Service" \
                "TCP :3011. Meeting lifecycle. LiveKit token. Transactional Outbox call events. HPA 1-3." \
                "NestJS TCP | apps" "Service"

            mediaworker = container "Media Worker" \
                "No port. Kafka consumer. Sharp thumbnail. ffmpeg transcode 720p/360p. KEDA Kafka-lag 1-4." \
                "Kafka consumer | apps" "Worker"

            # ── Message Broker ────────────────────────────────────────────
            kafka = container "Kafka" \
                "Event streaming. 30+ topics. RF=1 dev (3 prod). Topics theo nhom: chat.event.* / friendship.* / call.event.* / media.* / presence.* / group.event.*. Dev: Confluent cp-kafka:7.6.0 + ZooKeeper :2181. Production: Bitnami Kafka 32.4.3 KRaft." \
                "Confluent Kafka 7.6 (dev) / Bitnami 32.4.3 KRaft (prod) | infrastructure" "Queue"

            # ── Cache ─────────────────────────────────────────────────────
            redis = container "Redis" \
                "DB0: session/JWKS/OTP cache (Gateway), presence TTL, conv membership cache, friendship 4-key MGET, Kafka outbox list, offset INCR + dirty set, Socket.IO adapter, BullMQ queues. DB1: friendship lists." \
                "redis:7-alpine (dev) | Bitnami Redis 25.5.3 (prod) | infrastructure" "Cache"

            # ── Databases ─────────────────────────────────────────────────
            pgchat = container "postgres-chat" \
                "5 databases: chat_core_db, message_store_db, conversation_service_db, call_service_db, notification_service_db. Dev: postgres:16-alpine. Production (K8s): Bitnami PostgreSQL 18.6.6." \
                "postgres:16-alpine (dev) | Bitnami PostgreSQL 18.6.6 (prod) | infrastructure" "Database"

            pgusers = container "postgres-users" \
                "2 databases: users_service_db, friendship_service_db. Dev: postgres:16-alpine. Production (K8s): Bitnami PostgreSQL 18.6.6." \
                "postgres:16-alpine (dev) | Bitnami PostgreSQL 18.6.6 (prod) | infrastructure" "Database"

            mongo = container "MongoDB" \
                "Media metadata: ownerId, mimeType, size, status (PENDING/UPLOADED/READY/FAILED), objectKey, variants (thumb/preview/720p/360p/poster). worker-01." \
                "Mongo 7 | infrastructure" "Database"

            minio = container "MinIO" \
                "S3-compatible. Presigned PUT/GET URL. Bucket: media. storage.squad.id.vn." \
                "MinIO | infrastructure" "Storage"

            # ── Security & Config ─────────────────────────────────────────
            vault = container "HashiCorp Vault" \
                "Secret store tap trung. Raft HA. Path: secret/apps/<service>. Longhorn 10Gi." \
                "Vault 0.28.1 | infrastructure" "Infra"

            keycloaksvc = container "Keycloak" \
                "IAM. OAuth2/OIDC. JWT RS256. Realm: nest-realm. auth.squad.id.vn." \
                "Keycloak 26 | infrastructure" "Infra"

            livekit_svc = container "LiveKit SFU" \
                "WebRTC SFU in-cluster. Port 7880/7882. IP public worker-01: 139.59.127.74." \
                "LiveKit Server | infrastructure" "Infra"

            # ══════════════════════════════════════════════════════════════
            # RELATIONSHIPS - HTTP / WebSocket / TCP
            # ══════════════════════════════════════════════════════════════

            user   -> nginx    "HTTPS / WSS"
            nginx  -> gateway  "api.squad.id.vn"
            nginx  -> rtgw     "ws.squad.id.vn"

            # Gateway -> Services (TCP)
            gateway -> users    "TCP RPC"
            gateway -> conv     "TCP RPC"
            gateway -> chatcore "TCP RPC"
            gateway -> msgstore "TCP RPC"
            gateway -> presence "TCP RPC"
            gateway -> friend   "TCP RPC"
            gateway -> media    "TCP RPC"
            gateway -> call     "TCP RPC"
            gateway -> notif    "TCP RPC"
            gateway -> keycloaksvc "GET JWKS verify JWT"

            # Realtime Gateway -> Services (TCP)
            rtgw -> chatcore "TCP RPC"
            rtgw -> conv     "TCP IS_MEMBER, GET_CONVERSATION"
            rtgw -> presence "TCP SET_ONLINE/OFFLINE"
            rtgw -> call     "TCP signaling proxy"
            rtgw -> keycloaksvc "GET JWKS WS auth"

            # Inter-service TCP
            chatcore -> conv    "TCP GET_CONVERSATION - L0 cache miss"
            chatcore -> friend  "TCP stranger check fallback"
            chatcore -> media   "TCP validate mediaId"
            msgstore -> conv    "TCP cold path INCREMENT_MAX_OFFSET"
            call     -> livekit_svc "REST issue token + room"

            # ══════════════════════════════════════════════════════════════
            # RELATIONSHIPS - KAFKA (Publish / Consume)
            # ══════════════════════════════════════════════════════════════

            # Chat Core
            chatcore -> kafka "PUBLISH chat.event.message_accepted (partition: conversationId)"
            chatcore -> kafka "PUBLISH chat.event.message_edited"
            chatcore -> kafka "PUBLISH chat.event.message_deleted"
            chatcore -> kafka "PUBLISH chat.event.message_pinned"
            chatcore -> kafka "PUBLISH chat.event.message_revoked"
            kafka -> chatcore "CONSUME friendship.blocked / unblocked -> update Redis block cache"
            kafka -> chatcore "CONSUME friendship.request.accepted / removed -> LWW CAS friends key"

            # Message Store
            kafka -> msgstore "CONSUME chat.event.message_accepted -> persist + assign offset"
            msgstore -> kafka "PUBLISH chat.event.message_saved (partition: conversationId)"
            msgstore -> kafka "PUBLISH chat.event.read"
            msgstore -> kafka "PUBLISH chat.event.deleted"

            # Conversation Service
            kafka -> conv "CONSUME friendship.request.accepted -> auto-create DIRECT conversation"
            kafka -> conv "CONSUME chat.event.member_added / removed -> invalidate Redis membership cache"
            conv -> kafka "PUBLISH chat.event.conversation_created"
            conv -> kafka "PUBLISH chat.event.conversation_updated"
            conv -> kafka "PUBLISH chat.event.member_added"
            conv -> kafka "PUBLISH chat.event.member_removed"
            conv -> kafka "PUBLISH group.event.* (settings/kick/leave/disband/poll/appointment)"

            # Friendship Service
            friend -> kafka "PUBLISH friendship.request.sent"
            friend -> kafka "PUBLISH friendship.request.accepted"
            friend -> kafka "PUBLISH friendship.request.rejected"
            friend -> kafka "PUBLISH friendship.removed"
            friend -> kafka "PUBLISH friendship.blocked"
            friend -> kafka "PUBLISH friendship.unblocked"

            # Call Service (via Transactional Outbox)
            call -> kafka "PUBLISH call.event.ringing (outbox)"
            call -> kafka "PUBLISH call.event.accepted (outbox)"
            call -> kafka "PUBLISH call.event.declined (outbox)"
            call -> kafka "PUBLISH call.event.ended (outbox)"
            kafka -> call "CONSUME chat.event.member_removed -> auto-end call (membership_revoked)"

            # Media Service + Worker
            media -> kafka "PUBLISH media.uploaded -> trigger worker"
            kafka -> mediaworker "CONSUME media.uploaded -> process thumb/transcode"
            mediaworker -> kafka "PUBLISH media.ready"
            mediaworker -> kafka "PUBLISH media.failed"

            # Presence
            # Presence Service chỉ dùng Redis (không có KafkaModule). Không publish Kafka events.

            # Users Service
            users -> kafka "PUBLISH user.profile.updated"
            users -> kafka "PUBLISH user.deleted"
            users -> kafka "PUBLISH user.deactivated"

            # Notification Service
            kafka -> notif "CONSUME chat.event.message_saved -> FCM/WebPush"
            kafka -> notif "CONSUME call.event.ringing -> urgent push"
            kafka -> notif "CONSUME group.event.* -> group push"

            # Realtime Gateway (broadcast)
            kafka -> rtgw "CONSUME chat.event.message_saved -> WS broadcast message:new + message:notify"
            kafka -> rtgw "CONSUME chat.event.message_updated -> WS message:edited / deleted"
            kafka -> rtgw "CONSUME chat.event.typing_started / stopped -> WS typing indicator"
            kafka -> rtgw "CONSUME presence.changed -> WS presence update"
            kafka -> rtgw "CONSUME call.event.* -> WS call:ringing / accepted / ended"
            kafka -> rtgw "CONSUME conversation.* / member.* -> WS conv updated"
            kafka -> rtgw "CONSUME group.event.* -> WS group events"
            rtgw -> kafka "PUBLISH chat.event.typing_started"
            rtgw -> kafka "PUBLISH chat.event.typing_stopped"

            # ══════════════════════════════════════════════════════════════
            # RELATIONSHIPS - REDIS
            # ══════════════════════════════════════════════════════════════

            gateway  -> redis "DB0: session cache 30s, JWKS cache 1h, OTP TTL 5m, avatar URL cache"
            rtgw     -> redis "DB0: Socket.IO adapter, ws:connection map, revocation pub/sub"
            chatcore -> redis "DB0: L0 conv meta cache 5min, membership SISMEMBER, 4-key friendship MGET, Kafka outbox list lpush/lpop"
            msgstore -> redis "DB0: INCR_IF_EXISTS Lua script (offset), SADD dirty_offsets set"
            conv     -> redis "DB0: write-through membership cache SADD, OffsetSync read dirty set"
            presence -> redis "DB0: SET online:{userId} TTL 60s"
            friend   -> redis "DB1: friend lists cache, invalidate on change"
            notif    -> redis "DB0: BullMQ queues delayed push"
            call     -> redis "DB0: user call status cache TTL 30s"

            # ══════════════════════════════════════════════════════════════
            # RELATIONSHIPS - DATABASES
            # ══════════════════════════════════════════════════════════════

            users    -> pgusers "users_service_db: users, outbox_events"
            friend   -> pgusers "friendship_service_db: friendships, friend_requests, blocks, outbox_events"

            chatcore -> pgchat  "chat_core_db: (no tables - validation only)"
            msgstore -> pgchat  "message_store_db: messages, message_edit_history, pinned_messages, media_bindings, stickers, message_user_deletions, outbox_events"
            conv     -> pgchat  "conversation_service_db: conversations, conversation_members, group_join_requests, polls, appointments, outbox_events"
            call     -> pgchat  "call_service_db: calls, call_participants, call_summaries, outbox_events"
            notif    -> pgchat  "notification_service_db: device_tokens, notification_preferences"

            media    -> mongo   "media_db: media records + variants"
            mediaworker -> mongo "Update status READY/FAILED + write variant objectKeys"

            media    -> minio   "Generate presigned PUT/GET URL. Bucket: media."
            mediaworker -> minio "Read original file, write thumb/preview/720p/360p variants"

            # ══════════════════════════════════════════════════════════════
            # RELATIONSHIPS - EXTERNAL
            # ══════════════════════════════════════════════════════════════

            notif -> fcm    "FCM push Android/iOS via firebase-admin"
            notif -> resend "Email OTP + password reset via Resend API"
        }

        user -> backend "Chat, goi video, chia se media"
    }

    # ══════════════════════════════════════════════════════════════════
    # VIEWS
    # ══════════════════════════════════════════════════════════════════

    views {

        container backend "BackendOverview" "Tong quan toan bo Backend: Services, Kafka, Redis, Database" {
            include *
            autoLayout lr
        }

        container backend "ServicesOnly" "Chi services va TCP communication" {
            include nginx gateway rtgw
            include users presence chatcore msgstore notif conv friend media call mediaworker
            autoLayout tb
        }

        container backend "KafkaFlow" "Kafka event flow giua cac services" {
            include chatcore msgstore conv friend call media mediaworker notif rtgw presence users kafka
            autoLayout lr
        }

        container backend "DataLayer" "Storage: Redis, Postgres, MongoDB, MinIO" {
            include chatcore msgstore conv friend call media mediaworker notif users presence
            include redis pgchat pgusers mongo minio
            autoLayout tb
        }

        styles {
            element "Person" {
                shape Person
                background #1a1a2e
                color #ffffff
            }
            element "Software System" {
                background #16213e
                color #ffffff
            }
            element "External" {
                background #4a4a6a
                color #ffffff
            }
            element "Gateway" {
                background #0f3460
                color #ffffff
            }
            element "Service" {
                background #533483
                color #ffffff
            }
            element "Worker" {
                background #3d2b8e
                color #ffffff
            }
            element "Queue" {
                shape Pipe
                background #c0392b
                color #ffffff
            }
            element "Cache" {
                shape Cylinder
                background #27ae60
                color #ffffff
            }
            element "Database" {
                shape Cylinder
                background #e67e22
                color #ffffff
            }
            element "Storage" {
                shape Cylinder
                background #7f8c8d
                color #ffffff
            }
            element "Edge" {
                background #2c3e50
                color #ffffff
            }
            element "Infra" {
                background #636363
                color #ffffff
            }
            relationship "Relationship" {
                dashed false
                color #666666
            }
        }

        themes default
    }
}

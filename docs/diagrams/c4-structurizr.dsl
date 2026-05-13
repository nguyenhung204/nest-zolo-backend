workspace "Zolo Chat Platform" "C4 Model — squad.id.vn" {

    model {

        # ══════════════════════════════════════════════════
        # LEVEL 1 — ACTORS & EXTERNAL SYSTEMS
        # ══════════════════════════════════════════════════

        user      = person "End User"  "Người dùng — Web/Mobile (squad.id.vn)"
        operator  = person "Operator"  "DevOps/Admin — Grafana, ArgoCD, logs"
        developer = person "Developer" "Backend engineer — push code GitLab"

        keycloak = softwareSystem "Keycloak" \
            "OAuth2/OIDC Identity Provider, JWT RS256. auth.squad.id.vn" "External"
        livekit  = softwareSystem "LiveKit SFU" \
            "WebRTC media plane. livekit.squad.id.vn :7880-7882" "External"
        coturn   = softwareSystem "coturn TURN" \
            "TURN relay NAT traversal. 139.59.127.74:3478" "External"
        fcm      = softwareSystem "Firebase FCM" \
            "Push notification Android/iOS" "External"
        webpush  = softwareSystem "Web Push VAPID" \
            "Push notification browser" "External"
        resend   = softwareSystem "Resend" \
            "Transactional email/OTP. no-reply@squad.id.vn" "External"
        gitlabCI = softwareSystem "GitLab CI/CD" \
            "7-stage pipeline: detect → build → trivy → update-manifests" "External"
        argoCD   = softwareSystem "Argo CD" \
            "GitOps sync app-of-apps. argocd.squad.id.vn" "External"


        # ══════════════════════════════════════════════════
        # MAIN SYSTEM
        # ══════════════════════════════════════════════════

        zolo = softwareSystem "Zolo Chat Platform" \
            "Chat realtime, gọi video/thoại, chia sẻ media, quản lý nhóm. squad.id.vn" {

            # ════════════════════════════════════════════
            # LEVEL 2 — CONTAINERS
            # ════════════════════════════════════════════

            # ── Edge ──────────────────────────────────
            nginx = container "Nginx Ingress" \
                "TLS termination, reverse proxy. cert-manager Let's Encrypt. Route 8 subdomain." \
                "nginx-ingress | K8s cp-01" "Infrastructure"

            # ── API Layer ─────────────────────────────
            gateway = container "API Gateway" \
                "Cổng HTTP duy nhất. Xác thực JWT, route → TCP microservices, rate-limit, session cache. HPA min=2 max=3." \
                "NestJS HTTP :3000 | namespace:apps | worker-02" "Application" {

                keycloakGuard  = component "KeycloakGuard" \
                    "Verify JWT RS256 via JWKS. Cache public key Redis 1h."
                sessionCache   = component "SessionCacheService" \
                    "Fast-path cache authenticated session 30s."
                rateLimiter    = component "ThrottlerGuard" \
                    "Rate limit per IP/user — @nestjs/throttler + Redis."
                pooledProxy    = component "PooledTcpClientProxy" \
                    "Round-robin TCP proxy tới microservices. Timeout 5000ms."
                otpService     = component "OtpService" \
                    "HMAC-signed OTP forgot/reset password. TTL 5 phút Redis."
                healthCtrl     = component "HealthController" \
                    "GET /health → K8s liveness + readiness probe."
            }

            realtimeGW = container "Realtime Gateway" \
                "WebSocket gateway. Kafka consumer broadcast realtime events. hostNetwork=true. HPA 1→3." \
                "NestJS Socket.IO :3002 | namespace:stateful | worker-01" "Application" {

                wsAuth         = component "WsAuthHandler" \
                    "Client emit 'authenticate' + JWT → verify → set userId. 30s timeout."
                connManager    = component "ConnectionManager" \
                    "Socket map: personal room user:{id}, conv:{id}, call:{id}."
                redisAdapter   = component "Redis Socket.IO Adapter" \
                    "Scale nhiều WS instance. Revocation pub/sub."
                kafkaBroadcast = component "Kafka Event Broadcaster" \
                    "Consume message_saved → message:new + message:notify. typing, presence, call.event.*. Batch 80ms."
                signalingProxy = component "Call Signaling Proxy" \
                    "Proxy WebRTC offer/answer/ICE qua WS. Rate-limit per event type."
            }


            # ── Business Services ──────────────────────
            usersSvc = container "Users Service" \
                "Profile CRUD, Keycloak sync, avatar. HPA 1→3." \
                "NestJS TCP :3001 | apps | worker-02" "Application" {

                userCtrl   = component "UserController" \
                    "TCP: GET_USER, UPDATE_PROFILE, GET_USERS_BY_IDS, DEACTIVATE."
                userRepo   = component "UserRepository" \
                    "TypeORM: users — id(Keycloak sub), email, username, avatarMediaId, settings JSONB, isActive."
                avatarSvc  = component "AvatarUrlResolver" \
                    "Resolve avatarMediaId → presigned URL. Cache Redis."
            }

            chatCore = container "Chat Core" \
                "Nghiệp vụ chat: validation, ACL chain, 2-level cache, Kafka outbox. 3Gi RAM. HPA 1→3." \
                "NestJS TCP :3004 | namespace:stateful | worker-01" "Application" {

                sendOrch   = component "MessageSendOrchestrator" \
                    "rate-limit → validate conv → membership → friendship/block → Kafka publish."
                editOrch   = component "MessageEditOrchestrator" \
                    "Validate 1h edit window + ownership. Publish message_edited."
                deleteOrch = component "MessageDeleteOrchestrator" \
                    "Validate 24h window, role. Publish message_deleted."
                pinOrch    = component "MessagePinOrchestrator" \
                    "Max 3 pinned, role ADMIN+. Publish message_pinned."
                aclChain   = component "ACL Rule Chain" \
                    "MembershipRule → AccountStatusRule → InteractionRule → MediaRule → RateLimitRule. Strategy: direct/group/announcement."
                cacheLayer = component "Two-Level Cache" \
                    "L1 in-process 15s/30s. L0 Redis 5min. Singleflight → 1 TCP per burst. MGET 4 friendship keys."
                outbox     = component "Kafka Outbox Publisher" \
                    "Fire-and-forget. Fail → Redis list chat:kafka:outbox. Poller retry 500ms."
                friendConsumer = component "Friendship Cache Consumers" \
                    "Consume friendship.blocked/unblocked. LWW CAS friends key."
            }

            msgStore = container "Message Store" \
                "Persist messages, Redis atomic offset INCR. HPA 1→3." \
                "NestJS TCP :3005 | apps | worker-02" "Application" {

                msgConsumer  = component "MessageAcceptedConsumer" \
                    "Consume chat.event.message_accepted. Idempotency by messageId."
                offsetSvc    = component "AtomicOffsetService" \
                    "Lua INCR_IF_EXISTS. Warm: Redis O(1). Cold: TCP seed + NX set."
                syncJob      = component "OffsetSyncJob" \
                    "@Cron 5s. Dirty set → batch UPDATE conversations.max_offset."
                msgRepo      = component "MessageRepository" \
                    "TypeORM: INSERT messages + edit_history + pinned_messages."
                savedPublish = component "MessageSavedPublisher" \
                    "Publish chat.event.message_saved sau INSERT."
            }

            convSvc = container "Conversation Service" \
                "Conversation CRUD, membership, roles, group management v2, outbox. HPA 1→3." \
                "NestJS TCP :3007 | apps | worker-02" "Application" {

                convCtrl    = component "ConversationController" \
                    "TCP: CREATE, GET, LIST, UPDATE, GET_MEMBERS, IS_MEMBER, INCREMENT_OFFSET."
                groupMgmt   = component "Group Management Module" \
                    "Settings, kick, leave, disband, invite link JWT 7d, join requests, BullMQ appointment reminder."
                memberSvc   = component "MembershipService" \
                    "Add/remove, role mgmt (owner/admin/member), Redis write-through cache."
                outboxProc  = component "OutboxProcessor" \
                    "Poll outbox_events 30s. Publish conversation.* + call.* events lên Kafka."
                friendCons  = component "FriendshipAcceptedConsumer" \
                    "Consume friendship.request.accepted → auto-tạo DIRECT conversation."
            }


            presenceSvc = container "Presence Service" \
                "Online/offline heartbeat, Redis TTL keys. HPA 1→3." \
                "NestJS TCP :3003 | apps | worker-02" "Application" {

                presenceCtrl  = component "PresenceController" \
                    "TCP: SET_ONLINE, SET_OFFLINE, GET_PRESENCE_BULK."
                heartbeat     = component "HeartbeatHandler" \
                    "Client heartbeat 30s → SET online:{userId} TTL 60s Redis."
            }

            friendSvc = container "Friendship Service" \
                "Kết bạn, block, auto-tạo DIRECT conversation. HPA 1→3." \
                "NestJS TCP :3008 | apps | worker-02" "Application" {

                friendReqHandler = component "FriendRequestHandler" \
                    "SEND_REQUEST, ACCEPT (tx: delete req + insert 2 bidirectional rows), REJECT, UNFRIEND."
                blockHandler     = component "BlockHandler" \
                    "BLOCK/UNBLOCK. Publish friendship.blocked/unblocked."
                friendPublisher  = component "FriendshipEventPublisher" \
                    "Publish: .request.sent/accepted/rejected/removed/blocked/unblocked."
                friendCache      = component "FriendCacheService" \
                    "Cache friend lists Redis DB1. Invalidate khi thay đổi."
            }

            mediaSvc = container "Media Service" \
                "Presigned upload URL, metadata MongoDB, trigger worker. HPA 1→3." \
                "NestJS TCP :3009 | apps | worker-02" "Application" {

                uploadCtrl  = component "UploadController" \
                    "TCP: GENERATE_PRESIGNED_PUT, FINALIZE_UPLOAD, GET_MEDIA, DELETE_MEDIA."
                mediaRepo   = component "MediaRepository" \
                    "Mongoose: media — ownerId, mimeType, size, status, objectKey, variants[]."
                mediaPublish = component "MediaEventPublisher" \
                    "Publish media.uploaded → trigger worker processing."
            }

            callSvc = container "Call Service" \
                "Vòng đời cuộc gọi, LiveKit token, Transactional Outbox call events. HPA 1→3." \
                "NestJS TCP :3011 | apps | worker-02" "Application" {

                callOrch      = component "CallOrchestrationService" \
                    "START→RINGING. ACCEPT→ACTIVE+token. DECLINE→REJECTED. END→ENDED/MISSED."
                livekitToken  = component "LiveKitTokenService" \
                    "Cấp access token livekit-server-sdk. TTL 3600s."
                callOutbox    = component "CallOutboxProcessor" \
                    "Poll outbox_events → publish call.event.ringing/accepted/declined/ended."
                callCleanup   = component "CallCleanupJob" \
                    "@Cron 60s. Kết thúc ringing timeout + ghost calls."
                memberRevoke  = component "MembershipRevokedConsumer" \
                    "Consume member_removed → auto-end call, endReason: membership_revoked."
            }

            notifSvc = container "Notification Service" \
                "FCM push, VAPID web push, email OTP. KEDA Kafka-lag 1→3." \
                "NestJS TCP :3006 | apps | worker-02" "Application" {

                pushConsumer  = component "PushNotificationConsumer" \
                    "Consume message_saved → batch push. Consume call.event.ringing → urgent push."
                fcmSender     = component "FcmSender" \
                    "firebase-admin. FCM Android/iOS. Handle token refresh."
                webPushSend   = component "WebPushSender" \
                    "web-push VAPID → browser service workers."
                emailSend     = component "EmailSender" \
                    "Resend + nodemailer + Handlebars. OTP reset password."
                deviceRepo    = component "DeviceTokenRepository" \
                    "TypeORM: device_tokens — userId, platform (FCM/APNS/WEB), token, deviceId."
            }

            mediaWorker = container "Media Worker" \
                "Xử lý media background: thumbnail, transcode. KEDA Kafka-lag max=4." \
                "Kafka consumer | apps | worker-02" "Application" {

                mediaConsumer = component "MediaUploadedConsumer" \
                    "Consume media.uploaded. Idempotency. Dispatch sang image/video processor."
                imageProc     = component "ImageProcessor" \
                    "Sharp 0.34: thumb 320px WebP 70% + preview 1280px WebP 75%."
                videoProc     = component "VideoProcessor" \
                    "fluent-ffmpeg: poster frame + 720p CRF23 + 360p CRF26. 2 ffmpeg threads."
                recoveryJob   = component "MediaRecoveryJob" \
                    "@Cron retry PENDING/FAILED records. Không dùng Kafka retry topic."
            }


            # ── Infrastructure / Data ──────────────────
            kafka = container "Kafka" \
                "Event streaming. 30+ topics. Partition by conversationId. Dev: Confluent cp-kafka:7.6.0 + ZooKeeper. Production (K8s): Bitnami Kafka 32.4.3 KRaft, RF=1." \
                "Confluent Kafka 7.6 (dev) | Bitnami Kafka 32.4.3 KRaft (prod) | infrastructure" "Queue"

            redis = container "Redis" \
                "DB0: session/JWKS/OTP/conv cache/offset INCR/outbox/Socket.IO adapter. DB1: friendship lists. Dev: redis:7-alpine. Prod: Bitnami 25.5.3." \
                "redis:7-alpine (dev) | Bitnami Redis 25.5.3 (prod) | infrastructure" "Cache"

            pgChat = container "postgres-chat" \
                "5 DBs: chat_core_db, message_store_db, conversation_service_db, call_service_db, notification_service_db. Dev: postgres:16-alpine. Production (K8s): Bitnami PostgreSQL 18.6.6." \
                "postgres:16-alpine (dev) | Bitnami PostgreSQL 18.6.6 (prod) | infrastructure" "Database"

            pgUsers = container "postgres-users" \
                "2 DBs: users_service_db, friendship_service_db. Dev: postgres:16-alpine. Production (K8s): Bitnami PostgreSQL 18.6.6." \
                "postgres:16-alpine (dev) | Bitnami PostgreSQL 18.6.6 (prod) | infrastructure" "Database"

            pgbouncerChat  = container "PgBouncer Chat" \
                "Transaction pool trước postgres-chat. Max 1000 clients, pool 30." \
                "edoburu/pgbouncer 1.23.1 | infrastructure" "Infrastructure"

            pgbouncerUsers = container "PgBouncer Users" \
                "Transaction pool trước postgres-users. Max 500 clients, pool 20." \
                "edoburu/pgbouncer 1.23.1 | infrastructure" "Infrastructure"

            mongo   = container "MongoDB" \
                "Media metadata: ownerId, mimeType, size, status, objectKey, variants (thumb/preview/720p/360p/poster)." \
                "Mongo 7 | infrastructure | worker-01" "Database"

            minio   = container "MinIO S3" \
                "Object storage. Presigned PUT/GET. Bucket: media. storage.squad.id.vn." \
                "MinIO | infrastructure | worker-01" "Storage"

            vault   = container "HashiCorp Vault" \
                "Secret store. Raft HA. Path secret/apps/<service>. Longhorn 10Gi." \
                "Vault 0.28.1 Raft | infrastructure | worker-01" "Infrastructure"

            eso     = container "External Secrets Op." \
                "Sync Vault → K8s Secrets mỗi 5 phút. ClusterSecretStore: vault-backend." \
                "ESO | infrastructure" "Infrastructure"

            keycloakSvc = container "Keycloak" \
                "IAM: đăng ký, đăng nhập, refresh token, JWKS. Realm: nest-realm. auth.squad.id.vn." \
                "Keycloak 26 | infrastructure | worker-01" "Application"

            livekitK8s = container "LiveKit SFU (in-cluster)" \
                "WebRTC SFU. Port 7880/7881/7882. IP public worker-01 139.59.127.74." \
                "LiveKit Server | infrastructure | worker-01" "Infrastructure"

            coturnK8s = container "coturn (in-cluster)" \
                "TURN relay. Port 3478 UDP+TCP. Relay range 49160-49200 UDP." \
                "coturn | infrastructure | worker-01" "Infrastructure"

            prometheus = container "Prometheus + Grafana" \
                "Scrape /metrics 30s. Alertmanager. kafka-exporter :9308. Tempo tracing. grafana.squad.id.vn." \
                "kube-prometheus-stack | monitoring" "Monitoring"


            # ════════════════════════════════════════════
            # LEVEL 2 — CONTAINER RELATIONSHIPS
            # ════════════════════════════════════════════

            # Edge routing
            nginx -> gateway    "api.squad.id.vn → HTTP :3000"
            nginx -> realtimeGW "ws.squad.id.vn → WS :3002"
            nginx -> keycloakSvc "auth.squad.id.vn"
            nginx -> minio       "storage.squad.id.vn"

            # Gateway → Microservices
            gateway -> usersSvc    "TCP RPC"
            gateway -> convSvc     "TCP RPC"
            gateway -> chatCore    "TCP RPC"
            gateway -> msgStore    "TCP RPC"
            gateway -> presenceSvc "TCP RPC"
            gateway -> friendSvc   "TCP RPC"
            gateway -> mediaSvc    "TCP RPC"
            gateway -> callSvc     "TCP RPC"
            gateway -> notifSvc    "TCP RPC"
            gateway -> redis       "Session/JWKS/OTP/Avatar cache"
            gateway -> keycloakSvc "GET JWKS verify JWT"

            # Realtime Gateway
            realtimeGW -> chatCore    "TCP RPC"
            realtimeGW -> convSvc     "TCP IS_MEMBER, GET_CONVERSATION"
            realtimeGW -> presenceSvc "TCP SET_ONLINE/OFFLINE"
            realtimeGW -> callSvc     "TCP signaling proxy"
            realtimeGW -> redis       "Socket.IO adapter + WS conn map + revocation"
            realtimeGW -> kafka       "Consume: message_saved, typing, presence, call.event.*"
            realtimeGW -> keycloakSvc "GET JWKS WS auth"

            # Chat Core
            chatCore -> convSvc  "TCP GET_CONVERSATION (L0 miss)"
            chatCore -> friendSvc "TCP stranger check fallback"
            chatCore -> mediaSvc  "TCP validate mediaId"
            chatCore -> redis     "L0 conv cache + 4 friendship keys MGET + outbox list"
            chatCore -> kafka     "Publish: message_accepted/edited/deleted/pinned/revoked"

            # Message Store
            msgStore -> convSvc  "TCP cold path INCREMENT_MAX_OFFSET"
            msgStore -> redis    "INCR_IF_EXISTS Lua + dirty offsets SADD"
            msgStore -> pgbouncerChat "Kết nối qua pool"
            msgStore -> kafka    "Consume: message_accepted; Publish: message_saved, read, deleted"

            # Conversation Service
            convSvc -> pgbouncerChat "Kết nối qua pool"
            convSvc -> redis     "Write-through membership cache + OffsetSync dirty set"
            convSvc -> kafka     "Consume: friendship.request.accepted; Publish: conversation.*, member.*"

            # Users Service
            usersSvc -> pgbouncerUsers "Kết nối qua pool"
            usersSvc -> redis          "Avatar URL cache"

            # Friendship Service
            friendSvc -> pgbouncerUsers "Kết nối qua pool"
            friendSvc -> redis          "DB1 friend lists cache"
            friendSvc -> kafka          "Publish: friendship.* events"

            # Presence Service
            presenceSvc -> redis "SET online:{userId} TTL 60s"

            # Call Service
            callSvc -> pgbouncerChat "Kết nối qua pool"
            callSvc -> redis         "User call status cache TTL 30s"
            callSvc -> kafka         "Publish (outbox): call.event.*; Consume: member_removed"
            callSvc -> livekitK8s    "REST issue token + create/delete room"

            # Media Service
            mediaSvc -> mongo "CRUD media records + variants"
            mediaSvc -> minio "Generate presigned PUT/GET URLs"
            mediaSvc -> kafka "Publish: media.uploaded"

            # Media Worker
            mediaWorker -> mongo  "Update status READY/FAILED"
            mediaWorker -> minio  "Read original, write variants"
            mediaWorker -> kafka  "Consume: media.uploaded; Publish: media.ready/failed"

            # Notification Service
            notifSvc -> pgbouncerChat "Kết nối qua pool"
            notifSvc -> redis         "BullMQ queues delayed push"
            notifSvc -> kafka         "Consume: message_saved, call.event.ringing"

            # PgBouncer → Postgres
            pgbouncerChat  -> pgChat  "Transaction pool → 5 DBs"
            chatCore       -> pgbouncerChat "Kết nối qua pool"
            pgbouncerUsers -> pgUsers "Transaction pool → 2 DBs"

            # Secrets
            eso -> vault "Fetch secrets mỗi 5 phút → K8s Secrets"

            # Monitoring
            prometheus -> chatCore  "Scrape /metrics :30s"
            prometheus -> gateway   "Scrape /metrics :30s"
            prometheus -> kafka     "Via kafka-exporter :9308"
        }

        # ════════════════════════════════════════════════
        # LEVEL 1 — SYSTEM RELATIONSHIPS
        # ════════════════════════════════════════════════

        user      -> zolo     "Chat, gọi video, chia sẻ media"
        user      -> keycloak "Đăng nhập OAuth2, lấy JWT"
        operator  -> argoCD   "Deploy & sync apps"
        developer -> gitlabCI "git push → trigger pipeline"

        zolo -> keycloak "Verify JWT (JWKS endpoint)"
        zolo -> livekit  "Cấp token + điều phối WebRTC room"
        zolo -> coturn   "TURN relay cho WebRTC clients"
        zolo -> fcm      "Push notification Android/iOS"
        zolo -> webpush  "Push notification browser"
        zolo -> resend   "Email OTP + password reset"

        gitlabCI -> zolo  "Cập nhật image tag qua GitOps"
        argoCD   -> zolo  "Helm sync → K8s deployments"
    }


    # ══════════════════════════════════════════════════
    # VIEWS
    # ══════════════════════════════════════════════════

    views {

        # ── Level 1: System Context ─────────────────
        systemContext zolo "L1_Context" "C4 Level 1 — System Context" {
            include *
            autoLayout lr
        }

        # ── Level 2: All Containers ─────────────────
        container zolo "L2_All" "C4 Level 2 — Tất cả Containers" {
            include *
            autoLayout lr
        }

        # ── Level 2: API & Services ─────────────────
        container zolo "L2_Services" "C4 Level 2 — API & Business Services" {
            include nginx gateway realtimeGW
            include usersSvc chatCore msgStore convSvc
            include presenceSvc friendSvc mediaSvc callSvc notifSvc mediaWorker
            include kafka redis
            autoLayout tb
        }

        # ── Level 2: Data & Infrastructure ──────────
        container zolo "L2_Infra" "C4 Level 2 — Data & Infrastructure" {
            include pgChat pgUsers pgbouncerChat pgbouncerUsers
            include mongo minio redis kafka
            include vault eso keycloakSvc
            include livekitK8s coturnK8s prometheus
            autoLayout tb
        }

        # ── Level 3: API Gateway ─────────────────────
        component gateway "L3_Gateway" "C4 Level 3 — API Gateway Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Realtime Gateway ────────────────
        component realtimeGW "L3_RealtimeGW" "C4 Level 3 — Realtime Gateway Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Chat Core ───────────────────────
        component chatCore "L3_ChatCore" "C4 Level 3 — Chat Core Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Message Store ───────────────────
        component msgStore "L3_MessageStore" "C4 Level 3 — Message Store Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Conversation Service ───────────
        component convSvc "L3_ConvService" "C4 Level 3 — Conversation Service Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Call Service ────────────────────
        component callSvc "L3_CallService" "C4 Level 3 — Call Service Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Notification Service ───────────
        component notifSvc "L3_NotifService" "C4 Level 3 — Notification Service Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Media Worker ────────────────────
        component mediaWorker "L3_MediaWorker" "C4 Level 3 — Media Worker Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Users Service ───────────────────
        component usersSvc "L3_UsersService" "C4 Level 3 — Users Service Components" {
            include *
            autoLayout tb
        }

        # ── Level 3: Friendship Service ──────────────
        component friendSvc "L3_FriendService" "C4 Level 3 — Friendship Service Components" {
            include *
            autoLayout tb
        }

        # ══════════════════════════════════════════════
        # LEVEL 4 — CODE (Class diagram cho Chat Core)
        # Note: Structurizr render tự động từ code.
        # Dưới đây mô tả các class chính dạng code view.
        # ══════════════════════════════════════════════

        # ── Styles ──────────────────────────────────
        styles {
            element "Person" {
                shape Person
                background #08427B
                color #ffffff
                fontSize 16
            }
            element "Software System" {
                background #1168BD
                color #ffffff
            }
            element "External" {
                background #6b6b6b
                color #ffffff
            }
            element "Container" {
                background #438DD5
                color #ffffff
            }
            element "Application" {
                background #438DD5
                color #ffffff
            }
            element "Database" {
                shape Cylinder
                background #B86800
                color #ffffff
            }
            element "Queue" {
                shape Pipe
                background #CC7722
                color #ffffff
            }
            element "Cache" {
                shape Cylinder
                background #4A7C59
                color #ffffff
            }
            element "Storage" {
                shape Cylinder
                background #5D6D7E
                color #ffffff
            }
            element "Infrastructure" {
                background #636363
                color #ffffff
            }
            element "Monitoring" {
                background #7D3C98
                color #ffffff
            }
            element "Component" {
                background #85BBF0
                color #000000
            }
            relationship "Relationship" {
                dashed false
            }
        }

        themes default
    }
}
